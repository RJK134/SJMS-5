import prisma from './prisma';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Resolves the letter grade for a numeric mark using configured grade boundaries for the assessment.
 *
 * @param assessmentId - Identifier of the assessment whose grade boundaries are loaded.
 * @param mark - Raw mark as a JavaScript number or a Prisma {@link Decimal} value (coerced for comparison).
 * @returns A string grade letter when a boundary matches the mark, or `null` when no boundaries match (including when the mark falls outside every configured interval).
 * @remarks Returns `null` when no grade boundaries are configured for the assessment (empty result from the store).
 */
export async function resolveGradeFromMark(
  assessmentId: string,
  mark: number | Decimal,
): Promise<string | null> {
  const numericMark = typeof mark === 'number' ? mark : Number(mark);

  const boundaries = await prisma.gradeBoundary.findMany({
    where: { assessmentId },
    orderBy: { lowerBound: 'desc' },
  });

  if (boundaries.length === 0) return null;

  for (const boundary of boundaries) {
    if (numericMark >= Number(boundary.lowerBound) && numericMark <= Number(boundary.upperBound)) {
      return boundary.grade;
    }
  }

  return null;
}

// Mark aggregation now lives in `utils/marks-aggregation` (pure) and
// `api/marks/marks.service.aggregateForModuleRegistration` (orchestrator).
// Endpoint: POST /v1/marks/aggregate. Phase 17A — closes the original
// docs/review/phase-10b-now/07-priority-actions.md #5 priority action.
