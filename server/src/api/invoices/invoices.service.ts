import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/invoice.repository';
import * as feeAssessmentRepo from '../../repositories/feeAssessment.repository';
import * as financeRepo from '../../repositories/finance.repository';
import * as enrolmentRepo from '../../repositories/enrolment.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';
import {
  composeInvoiceFromAssessment,
  type ComposedInvoice,
  type InvoiceCompositionRules,
} from '../../utils/invoice-composition';

import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';

// ── List query ───────────────────────────────────────────────────────────────

export interface InvoiceListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  studentAccountId?: string;
  status?: string;
  invoiceNumber?: string;
}

export async function list(query: InvoiceListQuery) {
  const { cursor, limit, sort, order, studentAccountId, status, invoiceNumber } = query;
  return repo.list(
    { studentAccountId, status, invoiceNumber },
    { cursor, limit, sort, order },
  );
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('Invoice', id);
  return result;
}

export async function create(
  data: Prisma.InvoiceUncheckedCreateInput,
  userId: string,
  req: Request,
) {
  void data;
  void userId;
  void req;

  throw new ValidationError(
    'Direct invoice creation is not supported because it only persists the invoice header. Use the composed invoice creation workflow that also creates charge lines and updates the student account ledger before publishing audit and webhook events.',
  );
}

export async function update(
  id: string,
  data: Prisma.InvoiceUpdateInput,
  userId: string,
  req: Request,
) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('Invoice', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'invoice.updated',
    entityType: 'Invoice',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      invoiceNumber: result.invoiceNumber,
      status: result.status,
      paidAmount: toNumber(result.paidAmount as unknown as DecimalLike),
    },
  });
  if (result.status !== previous.status) {
    emitEvent({
      event: 'invoice.status_changed',
      entityType: 'Invoice',
      entityId: id,
      actorId: userId,
      data: {
        previousStatus: previous.status,
        newStatus: result.status,
      },
    });
  }
  return result;
}

export async function remove(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  await repo.softDelete(id);
  await logAudit('Invoice', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'invoice.deleted',
    entityType: 'Invoice',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: previous.studentAccountId,
      invoiceNumber: previous.invoiceNumber,
    },
  });
}

// ── Phase 18B — Generate invoice from a fee assessment ───────────────────────

export interface GenerateForFeeAssessmentOptions {
  studentAccountId?: string;
  issueDate?: Date;
  dueDate?: Date;
  currency?: string;
  invoiceNumber?: string;
  rules?: InvoiceCompositionRules;
  persist?: boolean;
  /** Regenerate even when an Invoice with the deterministic number already exists. */
  force?: boolean;
}

export interface GenerateForFeeAssessmentResult extends ComposedInvoice {
  feeAssessmentId: string;
  studentAccountId: string;
  /** True when an Invoice row was created on this call. */
  persisted: boolean;
  /** True when an existing Invoice was returned without modification (idempotency). */
  skipped: boolean;
  /** Set when persisted or skipped (the underlying Invoice ID). */
  invoiceId: string | null;
  /** Bursary / sponsor references rolled forward from the FeeAssessment audit trail. */
  bursaryReferences: string[];
  sponsorReferences: string[];
}

/**
 * Compose and (optionally) persist an invoice for an existing FeeAssessment.
 *
 * Pure composition is delegated to `utils/invoice-composition`; this
 * function is the I/O orchestrator. Idempotency is keyed on the
 * deterministic invoice number `INV-{shortYear}-{acc8}-{fa8}` —
 * re-runs return the existing row with `skipped: true` unless
 * `force: true` is supplied (in which case a `-R{n}` counter suffix
 * is appended so the original record is preserved).
 *
 * @throws NotFoundError when the FeeAssessment does not exist.
 * @throws ValidationError when the StudentAccount cannot be resolved
 *         and no `studentAccountId` override is supplied.
 */
export async function generateForFeeAssessment(
  feeAssessmentId: string,
  options: GenerateForFeeAssessmentOptions,
  userId: string,
  req: Request,
): Promise<GenerateForFeeAssessmentResult> {
  const feeAssessment = await feeAssessmentRepo.getById(feeAssessmentId);
  if (!feeAssessment) throw new NotFoundError('FeeAssessment', feeAssessmentId);

  // Resolve enrolment + studentAccount.
  const enrolment = await enrolmentRepo.getById(feeAssessment.enrolmentId);
  if (!enrolment) {
    throw new NotFoundError('Enrolment', feeAssessment.enrolmentId);
  }
  const studentId = (enrolment as unknown as { studentId?: string }).studentId ?? '';
  const academicYear = (enrolment as unknown as { academicYear?: string }).academicYear ?? '';
  const yearOfStudy = (enrolment as unknown as { yearOfStudy?: number }).yearOfStudy;
  const programme = (enrolment as unknown as {
    programme?: { title?: string; programmeCode?: string };
  }).programme;

  let studentAccount: { id: string; studentId: string; academicYear: string } | null = null;
  if (options.studentAccountId) {
    const lookup = await financeRepo.list(
      { studentId, academicYear },
      { cursor: undefined, limit: 1, sort: 'createdAt', order: 'desc' },
    );
    const explicit = lookup.data.find((a) => a.id === options.studentAccountId);
    if (!explicit) {
      throw new ValidationError(
        `StudentAccount ${options.studentAccountId} does not exist or does not match enrolment ${feeAssessment.enrolmentId} (studentId=${studentId}, academicYear=${academicYear}).`,
      );
    }
    studentAccount = { id: explicit.id, studentId: explicit.studentId, academicYear: explicit.academicYear };
  } else {
    if (!studentId || !academicYear) {
      throw new ValidationError(
        `Cannot resolve StudentAccount for fee assessment ${feeAssessmentId}: enrolment is missing studentId or academicYear.`,
      );
    }
    const found = await financeRepo.findByStudentAndYear(studentId, academicYear);
    if (!found) {
      throw new ValidationError(
        `No StudentAccount exists for student ${studentId} in academicYear ${academicYear}. Create one via POST /v1/finance before generating an invoice.`,
      );
    }
    studentAccount = { id: found.id, studentId: found.studentId, academicYear: found.academicYear };
  }

  // Compose the invoice body. Pure utility — no I/O here.
  const composed = composeInvoiceFromAssessment({
    feeAssessment: {
      id: feeAssessment.id,
      enrolmentId: feeAssessment.enrolmentId,
      totalFee: toNumber(feeAssessment.totalFee as unknown as DecimalLike),
      discountAmount: toNumber(feeAssessment.discountAmount as unknown as DecimalLike),
      finalFee: toNumber(feeAssessment.finalFee as unknown as DecimalLike),
      feeStatus: feeAssessment.feeStatus,
    },
    studentAccount: {
      id: studentAccount.id,
      studentId: studentAccount.studentId,
      academicYear: studentAccount.academicYear,
    },
    enrolment: {
      ...(typeof yearOfStudy === 'number' ? { yearOfStudy } : {}),
      ...(programme ? { programme } : {}),
    },
    ...(options.issueDate ? { issueDate: options.issueDate } : {}),
    ...(options.dueDate ? { dueDate: options.dueDate } : {}),
    ...(options.currency ? { currency: options.currency } : {}),
    ...(options.invoiceNumber ? { invoiceNumberOverride: options.invoiceNumber } : {}),
    ...(options.rules ? { rules: options.rules } : {}),
  });

  let persisted = false;
  let skipped = false;
  let invoiceId: string | null = null;
  let resolvedInvoiceNumber = composed.invoiceNumber;

  if (options.persist === true) {
    const existing = await repo.findByInvoiceNumber(composed.invoiceNumber);
    if (existing && options.force !== true) {
      // Idempotent re-run — return the existing row.
      invoiceId = existing.id;
      skipped = true;
      resolvedInvoiceNumber = existing.invoiceNumber;
    } else {
      // Force-regenerate path: append a -R{n} suffix to preserve the
      // original record. The suffix counter is the number of existing
      // invoices that already share the base invoice number.
      if (existing && options.force === true) {
        const baseNumber = composed.invoiceNumber;
        let counter = 1;
        let candidate = `${baseNumber}-R${counter}`;
        // Walk forward until we find a free slot. In practice this loop
        // terminates within 1-2 iterations; the upper bound prevents an
        // infinite loop in pathological cases.
        for (; counter < 100; counter += 1) {
          candidate = `${baseNumber}-R${counter}`;
          // eslint-disable-next-line no-await-in-loop
          const collision = await repo.findByInvoiceNumber(candidate);
          if (!collision) break;
        }
        resolvedInvoiceNumber = candidate;
      }

      const invoice = await repo.createWithLines(
        {
          studentAccountId: studentAccount.id,
          invoiceNumber: resolvedInvoiceNumber,
          issueDate: composed.issueDate,
          dueDate: composed.dueDate,
          totalAmount: composed.totalAmount,
          status: composed.status,
          createdBy: userId,
        },
        composed.lines.map((line) => ({
          chargeType: line.chargeType,
          description: line.description,
          amount: line.amount,
          currency: line.currency,
          ...(line.taxCode ? { taxCode: line.taxCode } : {}),
          status: line.status,
          dueDate: line.dueDate,
          createdBy: userId,
        })),
      );

      invoiceId = invoice.id;
      persisted = true;

      await logAudit('Invoice', invoice.id, 'CREATE', userId, null, invoice, req);
      emitEvent({
        event: 'invoice.created',
        entityType: 'Invoice',
        entityId: invoice.id,
        actorId: userId,
        data: {
          studentAccountId: invoice.studentAccountId,
          invoiceNumber: invoice.invoiceNumber,
          totalAmount: toNumber(invoice.totalAmount as unknown as DecimalLike),
          status: invoice.status,
          feeAssessmentId,
        },
      });
    }
  }

  // Always emit `invoice.generated` for audit traceability of preview /
  // persist / skipped runs alike. The Invoice row's own CREATE audit
  // (inside the persist branch above) captures the persisted-row case;
  // this event captures the composition outcome regardless of mode so
  // n8n integrations can react to a generation attempt without inferring
  // it from a row-level CREATE.
  emitEvent({
    event: 'invoice.generated',
    entityType: 'Invoice',
    entityId: invoiceId ?? feeAssessmentId,
    actorId: userId,
    data: {
      feeAssessmentId,
      studentAccountId: studentAccount.id,
      invoiceNumber: resolvedInvoiceNumber,
      totalAmount: composed.totalAmount,
      persisted,
      skipped,
      ...(options.force === true ? { force: true } : {}),
    },
  });

  return {
    ...composed,
    invoiceNumber: resolvedInvoiceNumber,
    feeAssessmentId,
    studentAccountId: studentAccount.id,
    persisted,
    skipped,
    invoiceId,
    bursaryReferences: [],
    sponsorReferences: [],
  };
}
