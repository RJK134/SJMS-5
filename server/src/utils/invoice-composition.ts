/**
 * Phase 18B — Invoice composition (pure utility).
 *
 * Composes a structured invoice (header + charge lines) from a
 * FeeAssessment outcome. This module is intentionally pure: no
 * Prisma, no I/O, no environmental coupling — same purity contract
 * as `marks-aggregation` (17A), `progression-decision` /
 * `award-classification` (17D), `transcript-composition` (17E),
 * and `fee-calculation` (18A).
 *
 * The composer is the canonical "FeeAssessment → invoice body"
 * translation step. The fee assessor (18A) decides what to charge;
 * this composer decides how to express the charge to the student.
 *
 * Default policy (overridable per call via `rules`):
 *   - Single TUITION line for `finalFee` (the post-discount amount
 *     the student actually owes — bursary/sponsor deductions are
 *     already applied at the FeeAssessment layer and are recorded
 *     in the invoice notes for audit traceability rather than as
 *     separate charge lines).
 *   - issueDate defaults to "now" (the composer is deterministic
 *     in test under a frozen clock; the I/O orchestrator owns the
 *     real Date.now()).
 *   - dueDate defaults to issueDate + 30 days.
 *   - currency defaults to GBP.
 *   - invoiceNumber is deterministic from the FeeAssessment ID and
 *     StudentAccount ID (`INV-{shortYear}-{acc8}-{fa8}`) so the
 *     persistence layer can resolve idempotency without a schema
 *     migration adding a `feeAssessmentId` FK.
 */

// Locally re-declared enums (avoid pulling Prisma types into a
// utility file — keeps the test surface free of the Prisma client).
export type ChargeType =
  | 'TUITION'
  | 'BENCH_FEE'
  | 'RESIT'
  | 'LATE_FEE'
  | 'LIBRARY_FINE'
  | 'ACCOMMODATION'
  | 'OTHER';

export type ChargeStatus =
  | 'PENDING'
  | 'INVOICED'
  | 'PAID'
  | 'CREDITED'
  | 'WRITTEN_OFF';

export type InvoiceStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'CANCELLED'
  | 'WRITTEN_OFF';

export interface InvoiceCompositionRules {
  /** Default payment-due window in days from issue date. Defaults to 30. */
  defaultDueDays?: number;
  /** Charge type for the tuition line. Defaults to `TUITION`. */
  tuitionChargeType?: ChargeType;
  /** Optional tax code stamped on the tuition line (e.g. `Z` for zero-rated). */
  tuitionTaxCode?: string;
  /** Initial invoice status. Defaults to `DRAFT`. */
  initialStatus?: InvoiceStatus;
  /** Initial line status. Defaults to `PENDING`. */
  initialLineStatus?: ChargeStatus;
}

export interface InvoiceCompositionInput {
  feeAssessment: {
    id: string;
    enrolmentId: string;
    totalFee: number;
    discountAmount: number;
    finalFee: number;
    feeStatus?: string;
    bursaryReferences?: string[];
    sponsorReferences?: string[];
  };
  studentAccount: {
    id: string;
    studentId: string;
    academicYear: string;
  };
  enrolment?: {
    yearOfStudy?: number;
    programme?: {
      title?: string;
      programmeCode?: string;
    } | null;
  };
  /** Issue date — caller is responsible for passing the real Date.now() at the I/O boundary. */
  issueDate?: Date;
  /** Optional explicit dueDate override (otherwise computed from issueDate + rules.defaultDueDays). */
  dueDate?: Date;
  /** Currency code. Defaults to "GBP". */
  currency?: string;
  /** Override the deterministic invoice number (e.g. for a force-regenerate replacement). */
  invoiceNumberOverride?: string;
  rules?: InvoiceCompositionRules;
}

export interface ComposedInvoiceLine {
  chargeType: ChargeType;
  description: string;
  amount: number;
  currency: string;
  taxCode?: string;
  status: ChargeStatus;
  dueDate: Date;
}

export interface ComposedInvoice {
  invoiceNumber: string;
  studentAccountId: string;
  issueDate: Date;
  dueDate: Date;
  totalAmount: number;
  status: InvoiceStatus;
  lines: ComposedInvoiceLine[];
  /** Effective rules used for the composition (audit trail). */
  effectiveRules: Required<Pick<InvoiceCompositionRules,
    'defaultDueDays' | 'tuitionChargeType' | 'initialStatus' | 'initialLineStatus'
  >> & { tuitionTaxCode: string | null };
  /** Operator-facing notes (e.g. bursary/sponsor references applied at the assessment layer). */
  notes: string[];
}

const DEFAULT_RULES: Required<Pick<InvoiceCompositionRules,
  'defaultDueDays' | 'tuitionChargeType' | 'initialStatus' | 'initialLineStatus'
>> = {
  defaultDueDays: 30,
  tuitionChargeType: 'TUITION',
  initialStatus: 'DRAFT',
  initialLineStatus: 'PENDING',
};

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function shortAcademicYear(academicYear: string): string {
  // "2025/26" → "2526". Falls back to last 4 chars (no slashes) if the
  // input does not match the canonical pattern.
  const stripped = academicYear.replace(/[^0-9]/g, '');
  if (stripped.length >= 4) return stripped.slice(-4);
  return stripped.padStart(4, '0');
}

function shortId(id: string, length = 8): string {
  if (!id) return ''.padStart(length, '0');
  // Take the trailing slice (cuid suffix is the high-entropy part).
  return id.slice(-length).toUpperCase();
}

/**
 * Compose an invoice body from a FeeAssessment outcome. Pure function —
 * no Prisma, no I/O. The persistence layer (`invoices.service`)
 * supplies the issueDate at the I/O boundary so this function is
 * deterministic under a frozen clock in tests.
 */
export function composeInvoiceFromAssessment(input: InvoiceCompositionInput): ComposedInvoice {
  const rules = {
    ...DEFAULT_RULES,
    ...(input.rules ?? {}),
  };
  const tuitionTaxCode = input.rules?.tuitionTaxCode ?? null;

  const currency = input.currency ?? 'GBP';
  const issueDate = input.issueDate ?? new Date();
  const dueDate = input.dueDate
    ?? new Date(issueDate.getTime() + rules.defaultDueDays * 24 * 60 * 60 * 1000);

  const finalFee = round2(input.feeAssessment.finalFee);

  const programmeTitle = input.enrolment?.programme?.title?.trim();
  const programmeCode = input.enrolment?.programme?.programmeCode?.trim();
  const yearOfStudy = input.enrolment?.yearOfStudy;
  const academicYear = input.studentAccount.academicYear;

  const descriptionParts = ['Tuition fee'];
  if (academicYear) descriptionParts.push(academicYear);
  if (programmeTitle) {
    descriptionParts.push(`— ${programmeTitle}${programmeCode ? ` (${programmeCode})` : ''}`);
  } else if (programmeCode) {
    descriptionParts.push(`— ${programmeCode}`);
  }
  if (typeof yearOfStudy === 'number' && yearOfStudy > 0) {
    descriptionParts.push(`Year ${yearOfStudy}`);
  }
  const description = descriptionParts.join(' ');

  const lines: ComposedInvoiceLine[] = [
    {
      chargeType: rules.tuitionChargeType,
      description,
      amount: finalFee,
      currency,
      ...(tuitionTaxCode ? { taxCode: tuitionTaxCode } : {}),
      status: rules.initialLineStatus,
      dueDate,
    },
  ];

  const notes: string[] = [];
  if (round2(input.feeAssessment.discountAmount) > 0) {
    notes.push(
      `Bursary/sponsor discount of ${round2(input.feeAssessment.discountAmount).toFixed(2)} ${currency} applied at fee assessment FA-${shortId(input.feeAssessment.id, 8)} (gross ${round2(input.feeAssessment.totalFee).toFixed(2)} → net ${finalFee.toFixed(2)}).`,
    );
  }
  const bursaryRefs = input.feeAssessment.bursaryReferences?.filter((r) => r && r.length > 0) ?? [];
  if (bursaryRefs.length > 0) {
    notes.push(`Bursary references: ${bursaryRefs.join(', ')}`);
  }
  const sponsorRefs = input.feeAssessment.sponsorReferences?.filter((r) => r && r.length > 0) ?? [];
  if (sponsorRefs.length > 0) {
    notes.push(`Sponsor references: ${sponsorRefs.join(', ')}`);
  }
  if (finalFee === 0) {
    notes.push('Net invoice amount is 0 — invoice will be issued for record-keeping only.');
  }

  const invoiceNumber = input.invoiceNumberOverride
    ?? `INV-${shortAcademicYear(academicYear)}-${shortId(input.studentAccount.id, 8)}-${shortId(input.feeAssessment.id, 8)}`;

  return {
    invoiceNumber,
    studentAccountId: input.studentAccount.id,
    issueDate,
    dueDate,
    totalAmount: finalFee,
    status: rules.initialStatus,
    lines,
    effectiveRules: { ...rules, tuitionTaxCode },
    notes,
  };
}
