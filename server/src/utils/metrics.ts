import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

export const register = new Registry();
collectDefaultMetrics({ register });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// ── Ledger anomaly detection (Phase 1E) ──────────────────────────────────────
// The finance ledger-anomaly scan (negative balances, orphan ChargeLines,
// duplicate invoice numbers) updates these on every run. The gauge holds the
// current anomaly count per (type, severity); the counter tracks scan
// successes/failures; the last-scan gauge lets an alert fire if the cron
// stops running. See workers/ledger-anomaly-cron.worker.ts + the alert rules
// in docker/prometheus/alerts.yml.

export const ledgerAnomalyGauge = new Gauge({
  name: 'sjms_ledger_anomalies',
  help: 'Ledger anomalies found on the most recent scan, by type and severity',
  labelNames: ['type', 'severity'],
  registers: [register],
});

export const ledgerAnomalyScanTotal = new Counter({
  name: 'sjms_ledger_anomaly_scans_total',
  help: 'Total ledger anomaly scans, by status',
  labelNames: ['status'],
  registers: [register],
});

export const ledgerAnomalyLastScanTimestamp = new Gauge({
  name: 'sjms_ledger_anomaly_last_scan_timestamp',
  help: 'Unix timestamp (seconds) of the last completed ledger anomaly scan',
  registers: [register],
});

const LEDGER_ANOMALY_TYPES = [
  'NEGATIVE_BALANCE',
  'ORPHAN_CHARGE_LINE',
  'DUPLICATE_INVOICE_NUMBER',
] as const;
const LEDGER_ANOMALY_SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;

/**
 * Record a successful ledger anomaly scan. Resets every (type, severity)
 * series to zero before applying the new counts so a *resolved* anomaly does
 * not leave a stale non-zero series lingering on the gauge. `byTypeSeverity`
 * maps the key `${type}|${severity}` to a count.
 */
export function recordLedgerAnomalyScan(byTypeSeverity: Record<string, number>): void {
  for (const type of LEDGER_ANOMALY_TYPES) {
    for (const severity of LEDGER_ANOMALY_SEVERITIES) {
      ledgerAnomalyGauge.set(
        { type, severity },
        byTypeSeverity[`${type}|${severity}`] ?? 0,
      );
    }
  }
  ledgerAnomalyScanTotal.inc({ status: 'success' });
  ledgerAnomalyLastScanTimestamp.set(Math.floor(Date.now() / 1000));
}

/** Record a failed ledger anomaly scan (the scan itself threw). */
export function recordLedgerAnomalyScanFailure(): void {
  ledgerAnomalyScanTotal.inc({ status: 'failure' });
}
