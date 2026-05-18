import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { PAYMENT_PLAN_SORT } from '../utils/repository-sort-allow-lists';

export interface PaymentPlanFilters {
  studentAccountId?: string;
  status?: string;
  planType?: string;
}

const defaultInclude = {
  studentAccount: { include: { student: { include: { person: true } } } },
  instalments: { orderBy: { instalmentNum: 'asc' as const } },
} satisfies Prisma.PaymentPlanInclude;

export async function list(
  filters: PaymentPlanFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.PaymentPlanWhereInput = {
    ...(filters.studentAccountId && { studentAccountId: filters.studentAccountId }),
    ...(filters.status && { status: filters.status as Prisma.PaymentPlanWhereInput['status'] }),
    ...(filters.planType && { planType: filters.planType }),
  };

  const [data, total] = await Promise.all([
    prisma.paymentPlan.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, PAYMENT_PLAN_SORT, 'startDate'),
    }),
    prisma.paymentPlan.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.paymentPlan.findUnique({
    where: { id },
    include: defaultInclude,
  });
}

/**
 * Find every active (non-CANCELLED, non-COMPLETED) PaymentPlan for a
 * StudentAccount. Used by the 18D bridge to detect that a payment
 * being allocated belongs to an in-flight plan.
 */
export async function findActiveByStudentAccount(studentAccountId: string) {
  return prisma.paymentPlan.findMany({
    where: {
      studentAccountId,
      status: { in: ['ACTIVE', 'DEFAULTED'] },
    },
    include: defaultInclude,
    orderBy: { startDate: 'asc' },
  });
}

export async function create(data: Prisma.PaymentPlanUncheckedCreateInput) {
  return prisma.paymentPlan.create({ data, include: defaultInclude });
}

export async function update(id: string, data: Prisma.PaymentPlanUpdateInput) {
  return prisma.paymentPlan.update({ where: { id }, data, include: defaultInclude });
}

/**
 * Hard-delete a PaymentPlan. The schema has no `deletedAt` column on
 * PaymentPlan, and `PaymentInstalment.paymentPlanId` is declared with
 * `onDelete: Cascade` in the Prisma schema so the row removal also
 * removes the schedule. Operators who want a logical-delete should
 * flip `status` to `CANCELLED` via `update()` instead.
 */
export async function remove(id: string) {
  return prisma.paymentPlan.delete({ where: { id } });
}

/**
 * Phase 18D — atomic PaymentPlan + PaymentInstalment write.
 *
 * Creates a PaymentPlan with its PaymentInstalment children in a
 * single Prisma transaction so the plan is never persisted without
 * its schedule. Mirrors the Phase 18B `invoice.repository.
 * createWithLines` pattern for Invoice + ChargeLine.
 *
 * Returns the persisted plan with instalments included so the caller
 * can return the structured payload directly.
 */
export async function createWithInstalments(
  plan: Prisma.PaymentPlanUncheckedCreateInput,
  instalments: ReadonlyArray<
    Omit<Prisma.PaymentInstalmentUncheckedCreateInput, 'paymentPlanId'>
  >,
) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.paymentPlan.create({
      data: {
        ...plan,
        instalments: {
          create: instalments.map((inst) => ({
            instalmentNum: inst.instalmentNum,
            amount: inst.amount,
            dueDate: inst.dueDate,
            ...(inst.status ? { status: inst.status } : {}),
            ...(inst.createdBy ? { createdBy: inst.createdBy } : {}),
          })),
        },
      },
      include: defaultInclude,
    });
    return created;
  });
}
