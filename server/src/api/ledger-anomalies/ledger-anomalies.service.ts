import type { Request } from 'express';
import * as repo from '../../repositories/ledgerAnomaly.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import {
  recordLedgerAnomalyScan,
  recordLedgerAnomalyScanFailure,
} from '../../utils/metrics';
import {
  classifyLedgerAnomalies,
  type LedgerAnomalyReport,
} from '../../utils/ledger-anomaly';

/**
 * Phase 1E — ledger anomaly scan orchestrator.
 *
 * Runs the three read-only detection queries, hands the raw rows to the
 * pure `classifyLedgerAnomalies` utility, records Prometheus metrics,
 * emits canonical webhook events, and audits the scan. **Read-only by
 * design** — it never mutates the ledger; remediation is a deliberate
 * operator action, not an automated side effect. The scan is invoked both
 * on-demand (`POST /v1/ledger-anomalies/scan`, FINANCE-gated) and on a
 * BullMQ schedule (`workers/ledger-anomaly-cron.worker.ts`).
 */

export interface ScanOptions {
  /** Cap on rows fetched per anomaly class. Defaults to the repository default. */
  limit?: number;
  /** Override the negative-balance HIGH-severity threshold (£). */
  negativeBalanceHighThreshold?: number;
}

export interface ScanResult extends LedgerAnomalyReport {
  scanId: string;
  scannedAt: string;
}

/** Build the `${type}|${severity}` → count map the metrics helper wants. */
function toMetricMap(report: LedgerAnomalyReport): Record<string, number> {
  const map: Record<string, number> = {};
  for (const a of report.anomalies) {
    const key = `${a.type}|${a.severity}`;
    map[key] = (map[key] ?? 0) + 1;
  }
  return map;
}

export async function scanLedgerAnomalies(
  options: ScanOptions,
  userId: string,
  req?: Request,
): Promise<ScanResult> {
  const scanId = `ledger-scan-${Date.now()}`;
  try {
    const [negativeBalances, orphanChargeLines, duplicateInvoiceNumbers] =
      await Promise.all([
        repo.findNegativeBalanceAccounts(options.limit),
        repo.findOrphanChargeLines(options.limit),
        repo.findDuplicateInvoiceNumbers(options.limit),
      ]);

    const report = classifyLedgerAnomalies({
      negativeBalances,
      orphanChargeLines,
      duplicateInvoiceNumbers,
      rules:
        typeof options.negativeBalanceHighThreshold === 'number'
          ? { negativeBalanceHighThreshold: options.negativeBalanceHighThreshold }
          : undefined,
    });

    recordLedgerAnomalyScan(toMetricMap(report));

    const scannedAt = new Date().toISOString();

    // Audit the scan as a synthetic subject (no single entity owns it). The
    // scan reads/inspects the ledger and produces no entity, so VIEW is the
    // honest AuditAction (the enum has CREATE|UPDATE|DELETE|VIEW|EXPORT — no
    // EXECUTE). The summary is captured in newData for the audit trail.
    await logAudit(
      'LedgerAnomalyScan',
      scanId,
      'VIEW',
      userId,
      null,
      {
        total: report.total,
        counts: report.counts,
        severityCounts: report.severityCounts,
        hasHighSeverity: report.hasHighSeverity,
        effectiveRules: report.effectiveRules,
      } as Record<string, unknown>,
      req,
    );

    // One scan-completed event carrying the summary.
    emitEvent({
      event: 'ledger.anomaly_scan_completed',
      entityType: 'LedgerAnomalyScan',
      entityId: scanId,
      actorId: userId,
      data: {
        total: report.total,
        counts: report.counts,
        severityCounts: report.severityCounts,
        hasHighSeverity: report.hasHighSeverity,
        scannedAt,
      },
    });

    // One event per individual anomaly so n8n can route per-type / per-
    // severity alerts (e.g. page on a HIGH cross-account leak, digest the
    // MEDIUM negative balances).
    for (const anomaly of report.anomalies) {
      emitEvent({
        event: 'ledger.anomaly_detected',
        entityType: 'LedgerAnomalyScan',
        entityId: scanId,
        actorId: userId,
        data: {
          scanId,
          type: anomaly.type,
          severity: anomaly.severity,
          entityId: anomaly.entityId,
          detail: anomaly.detail,
          ...anomaly.data,
        },
      });
    }

    return { ...report, scanId, scannedAt };
  } catch (err) {
    recordLedgerAnomalyScanFailure();
    throw err;
  }
}
