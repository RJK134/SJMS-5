/**
 * assessment generator
 *
 * D1: empty CSVs for all 39 assessment-domain models.
 * D7: ~600,000 AssessmentSubmission rows over 5 academic years (40k students
 *     × ~15 modules/year × ~2 components × 5 years scaled to active cohorts),
 *     Mark rows, ModerationRecord / SecondMarkingRecord / ModerationSampleRecord,
 *     ExamBoard + ExamBoardDecision per department per year, AppealRecord (~1%),
 *     MitigatingCircumstance (~10%), TurnitinSubmission, PlagiarismCase (~0.5%),
 *     plus the engagement/attendance tail (AttendanceSession ~80k, AttendanceRecord
 *     ~1.5M, EngagementScore + alerts, RetentionRiskScore per student per term).
 */

import { modelsByDomain } from '../lib/domain-map.mjs';

export const domain = 'assessment';

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  await ctx.writeEmptyFor(models);
  ctx.log(domain, `${models.length} empty CSVs written`);
}
