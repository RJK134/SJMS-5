/**
 * Phase 1E — pure ledger-anomaly classifier.
 *
 * Takes the raw projections produced by `ledgerAnomaly.repository` and
 * assembles a structured, severity-classified report. Pure and
 * side-effect-free — no Prisma, no I/O, no clock — so it is fully unit
 * testable. Same purity contract as the other Phase 17/18 rule engines
 * (`marks-aggregation`, `fee-calculation`, `payment-allocation`,
 * `bursary-decision`, …): the repository does the Prisma reads, this
 * utility does the arithmetic + classification, the service orchestrates
 * the side effects (metrics, events, audit).
 *
 * Three anomaly classes (the Phase 1E build-queue scope):
 *   1. NEGATIVE_BALANCE   — a StudentAccount whose balance is below zero.
 *                           In this ledger balance = debits − credits, so a
 *                           negative balance means the institution owes the
 *                           student or an over-allocation / double-credit
 *                           has occurred.
 *   2. ORPHAN_CHARGE_LINE — a live ChargeLine whose invoice has been
 *                           soft-deleted, or whose studentAccountId does
 *                           not match its invoice's studentAccountId
 *                           (a cross-account leak).
 *   3. DUPLICATE_INVOICE_NUMBER — two or more live invoices sharing an
 *                           invoiceNumber. The DB @unique constraint should
 *                           make this impossible; the scan surfaces it
 *                           defensively in case the constraint was ever
 *                           bypassed (raw migration, restore, etc.).
 *
 * Severity:
 *   - DUPLICATE_INVOICE_NUMBER and the cross-account ORPHAN_CHARGE_LINE
 *     are HIGH (financial correctness is compromised — money is attributed
 *     to the wrong account or an invoice identity collides).
 *   - the soft-deleted-invoice ORPHAN_CHARGE_LINE is MEDIUM (recoverable —
 *     the charge can be re-pointed or cancelled).
 *   - NEGATIVE_BALANCE is MEDIUM by default, escalated to HIGH when the
 *     magnitude is at or beyond `negativeBalanceHighThreshold`.
 */

export type LedgerAnomalyType =
  | 'NEGATIVE_BALANCE'
  | 'ORPHAN_CHARGE_LINE'
  | 'DUPLICATE_INVOICE_NUMBER';

export type LedgerAnomalySeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export type OrphanReason = 'INVOICE_SOFT_DELETED' | 'ACCOUNT_MISMATCH';

/** Raw negative-balance row from the repository. */
export interface NegativeBalanceRow {
  id: string;
  studentId: string;
  academicYear: string;
  balance: number;
}

/** Raw orphan-charge-line row from the repository. */
export interface OrphanChargeLineRow {
  id: string;
  studentAccountId: string;
  invoiceId: string | null;
  amount: number;
  reason: OrphanReason;
  /** The invoice's studentAccountId — set when reason is ACCOUNT_MISMATCH. */
  invoiceStudentAccountId?: string | null;
}

/** Raw duplicate-invoice-number group from the repository. */
export interface DuplicateInvoiceNumberRow {
  invoiceNumber: string;
  count: number;
  invoiceIds: string[];
}

export interface LedgerAnomalyRules {
  /**
   * Negative balances whose magnitude is at or beyond this value are HIGH;
   * smaller ones are MEDIUM. Defaults to 1000 (i.e. a £1,000 credit balance
   * or worse is HIGH). Non-finite / negative overrides fall back to default.
   */
  negativeBalanceHighThreshold?: number;
}

export interface LedgerAnomalyInput {
  negativeBalances: NegativeBalanceRow[];
  orphanChargeLines: OrphanChargeLineRow[];
  duplicateInvoiceNumbers: DuplicateInvoiceNumberRow[];
  rules?: LedgerAnomalyRules;
}

/** A single classified anomaly. */
export interface LedgerAnomaly {
  type: LedgerAnomalyType;
  severity: LedgerAnomalySeverity;
  /** The primary entity id (account id / charge-line id / invoice number). */
  entityId: string;
  /** Human-readable explanation captured for the audit trail. */
  detail: string;
  /** Structured payload for downstream consumers (n8n, dashboards). */
  data: Record<string, unknown>;
}

export interface LedgerAnomalyReport {
  anomalies: LedgerAnomaly[];
  /** Per-type counts. */
  counts: Record<LedgerAnomalyType, number>;
  /** Per-severity counts. */
  severityCounts: Record<LedgerAnomalySeverity, number>;
  total: number;
  /** True when at least one HIGH-severity anomaly was found. */
  hasHighSeverity: boolean;
  /** The merged rule set actually used, for audit replay. */
  effectiveRules: Required<LedgerAnomalyRules>;
}

const DEFAULT_NEGATIVE_BALANCE_HIGH_THRESHOLD = 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function resolveRules(rules: LedgerAnomalyRules | undefined): Required<LedgerAnomalyRules> {
  const raw = rules?.negativeBalanceHighThreshold;
  return {
    negativeBalanceHighThreshold:
      typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
        ? raw
        : DEFAULT_NEGATIVE_BALANCE_HIGH_THRESHOLD,
  };
}

export function classifyLedgerAnomalies(input: LedgerAnomalyInput): LedgerAnomalyReport {
  const effectiveRules = resolveRules(input.rules);
  const anomalies: LedgerAnomaly[] = [];

  // ── Negative balances ────────────────────────────────────────────────────
  for (const row of input.negativeBalances) {
    const balance = round2(row.balance);
    const magnitude = Math.abs(balance);
    const severity: LedgerAnomalySeverity =
      magnitude >= effectiveRules.negativeBalanceHighThreshold ? 'HIGH' : 'MEDIUM';
    anomalies.push({
      type: 'NEGATIVE_BALANCE',
      severity,
      entityId: row.id,
      detail:
        `StudentAccount ${row.id} (student ${row.studentId}, ${row.academicYear}) ` +
        `has a negative balance of £${balance}.`,
      data: {
        studentAccountId: row.id,
        studentId: row.studentId,
        academicYear: row.academicYear,
        balance,
      },
    });
  }

  // ── Orphan charge lines ──────────────────────────────────────────────────
  for (const row of input.orphanChargeLines) {
    const severity: LedgerAnomalySeverity =
      row.reason === 'ACCOUNT_MISMATCH' ? 'HIGH' : 'MEDIUM';
    const detail =
      row.reason === 'ACCOUNT_MISMATCH'
        ? `ChargeLine ${row.id} (account ${row.studentAccountId}) is attached to ` +
          `invoice ${row.invoiceId} owned by a different account ` +
          `(${row.invoiceStudentAccountId ?? 'unknown'}).`
        : `ChargeLine ${row.id} (account ${row.studentAccountId}) points at ` +
          `soft-deleted invoice ${row.invoiceId}.`;
    anomalies.push({
      type: 'ORPHAN_CHARGE_LINE',
      severity,
      entityId: row.id,
      detail,
      data: {
        chargeLineId: row.id,
        studentAccountId: row.studentAccountId,
        invoiceId: row.invoiceId,
        amount: round2(row.amount),
        reason: row.reason,
        invoiceStudentAccountId: row.invoiceStudentAccountId ?? null,
      },
    });
  }

  // ── Duplicate invoice numbers ────────────────────────────────────────────
  for (const row of input.duplicateInvoiceNumbers) {
    anomalies.push({
      type: 'DUPLICATE_INVOICE_NUMBER',
      severity: 'HIGH',
      entityId: row.invoiceNumber,
      detail:
        `Invoice number ${row.invoiceNumber} is shared by ${row.count} live invoices ` +
        `(${row.invoiceIds.join(', ')}).`,
      data: {
        invoiceNumber: row.invoiceNumber,
        count: row.count,
        invoiceIds: row.invoiceIds.slice(),
      },
    });
  }

  const counts: Record<LedgerAnomalyType, number> = {
    NEGATIVE_BALANCE: 0,
    ORPHAN_CHARGE_LINE: 0,
    DUPLICATE_INVOICE_NUMBER: 0,
  };
  const severityCounts: Record<LedgerAnomalySeverity, number> = {
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };
  for (const a of anomalies) {
    counts[a.type] += 1;
    severityCounts[a.severity] += 1;
  }

  return {
    anomalies,
    counts,
    severityCounts,
    total: anomalies.length,
    hasHighSeverity: severityCounts.HIGH > 0,
    effectiveRules,
  };
}
