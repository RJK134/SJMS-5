import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { INVOICE_SORT } from '../utils/repository-sort-allow-lists';

export interface InvoiceFilters {
  studentAccountId?: string;
  status?: string;
  invoiceNumber?: string;
}

const defaultInclude = {
  studentAccount: {
    include: { student: { include: { person: true } } },
  },
  chargeLines: { orderBy: { createdAt: 'asc' as const } },
  payments: true,
} satisfies Prisma.InvoiceInclude;

export async function list(
  filters: InvoiceFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.InvoiceWhereInput = {
    deletedAt: null,
    ...(filters.studentAccountId && { studentAccountId: filters.studentAccountId }),
    ...(filters.status && { status: filters.status as Prisma.InvoiceWhereInput['status'] }),
    ...(filters.invoiceNumber && { invoiceNumber: filters.invoiceNumber }),
  };

  const [data, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, INVOICE_SORT, 'issueDate'),
    }),
    prisma.invoice.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.invoice.findFirst({
    where: { id, deletedAt: null },
    include: defaultInclude,
  });
}

export async function findByInvoiceNumber(invoiceNumber: string) {
  return prisma.invoice.findFirst({
    where: { invoiceNumber, deletedAt: null },
    include: defaultInclude,
  });
}

export async function create(data: Prisma.InvoiceUncheckedCreateInput) {
  return prisma.invoice.create({ data, include: defaultInclude });
}

export async function update(id: string, data: Prisma.InvoiceUpdateInput) {
  return prisma.invoice.update({ where: { id }, data, include: defaultInclude });
}

export async function softDelete(id: string) {
  return prisma.invoice.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

/**
 * Phase 18C — transaction-aware paidAmount increment used by the
 * payment-allocation pipeline. Caller supplies the `tx` from the
 * enclosing `$transaction` so the increment is atomic with the
 * ChargeLine status flip and the StudentAccount ledger update.
 */
export async function incrementPaidAmountInTx(
  id: string,
  amount: number,
  tx: Prisma.TransactionClient,
) {
  return tx.invoice.update({
    where: { id },
    data: { paidAmount: { increment: amount } },
  });
}

/**
 * Phase 18C — transaction-aware status read used by the payment-
 * allocation pipeline to decide whether to promote an invoice to
 * PAID / PARTIALLY_PAID after the paidAmount increment.
 */
export async function findStatusProjectionInTx(
  id: string,
  tx: Prisma.TransactionClient,
) {
  return tx.invoice.findUnique({
    where: { id },
    select: { id: true, totalAmount: true, paidAmount: true, status: true },
  });
}

/**
 * Phase 18C — transaction-aware status update.
 */
export async function updateStatusInTx(
  id: string,
  status: 'PAID' | 'PARTIALLY_PAID' | 'OVERDUE' | 'CANCELLED' | 'WRITTEN_OFF' | 'ISSUED' | 'DRAFT',
  tx: Prisma.TransactionClient,
) {
  return tx.invoice.update({
    where: { id },
    data: { status },
  });
}

/**
 * Phase 18B — atomic Invoice + ChargeLine creation with balance update.
 *
 * Creates an Invoice with its ChargeLine children in a single Prisma
 * transaction so the invoice is never persisted without its body.
 * Within the same transaction, the StudentAccount.balance is
 * incremented by the sum of charge amounts so the ledger and the
 * billing surface stay consistent (mirroring the existing
 * `finance.repository.createCharge` primitive but lifted to the
 * invoice level so the multi-line write is atomic).
 *
 * Each ChargeLine is persisted with the `status` passed by the caller,
 * defaulting to `INVOICED` when the caller does not supply a status.
 * The service layer is responsible for setting the appropriate status
 * (typically `INVOICED` for lines attached to a freshly issued invoice).
 *
 * Returns the persisted invoice with chargeLines included so the
 * caller can return the structured payload directly.
 */
export async function createWithLines(
  invoice: Prisma.InvoiceUncheckedCreateInput,
  lines: ReadonlyArray<
    Omit<Prisma.ChargeLineUncheckedCreateInput, 'invoiceId' | 'studentAccountId'>
  >,
  options: { incrementAccountBalance?: boolean } = {},
) {
  const incrementBalance = options.incrementAccountBalance !== false;
  const totalLineAmount = lines.reduce((sum, line) => {
    const amount = typeof line.amount === 'number'
      ? line.amount
      : Number(line.amount?.toString() ?? 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  return prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        ...invoice,
        chargeLines: {
          create: lines.map((line) => ({
            studentAccountId: invoice.studentAccountId,
            chargeType: line.chargeType,
            description: line.description,
            amount: line.amount,
            currency: line.currency ?? 'GBP',
            ...(line.taxCode != null ? { taxCode: line.taxCode } : {}),
            status: line.status ?? 'INVOICED',
            ...(line.dueDate ? { dueDate: line.dueDate } : {}),
            ...(line.createdBy ? { createdBy: line.createdBy } : {}),
          })),
        },
      },
      include: defaultInclude,
    });

    if (incrementBalance) {
      await tx.studentAccount.update({
        where: { id: invoice.studentAccountId },
        data: {
          ...(totalLineAmount !== 0
            ? { balance: { increment: totalLineAmount } }
            : {}),
          ...(totalLineAmount > 0
            ? { totalDebits: { increment: totalLineAmount } }
            : {}),
          ...(totalLineAmount < 0
            ? { totalCredits: { increment: Math.abs(totalLineAmount) } }
            : {}),
          lastTransactionDate: new Date(),
        },
      });
    }

    return created;
  });
}
