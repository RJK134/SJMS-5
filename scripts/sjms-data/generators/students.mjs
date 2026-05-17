/**
 * students generator
 *
 * D1: empty CSVs for all 25 students-domain models.
 * D6: 40,000 active Students with 5 years of Enrolment history, ModuleRegistration
 *     (~12-15 per student per year), StudentInstance / ProgrammeOccurrence /
 *     EnrolmentOccurrence (HESA Student Course Session shape),
 *     ModeOfStudyHistory, InterruptionEvent / TransferEvent / WithdrawalEvent
 *     for ~15% who change/leave, PersonalTutorAllocation + TutoringMeeting,
 *     ApprenticeshipRegistration (~5%) with OTJ / EPA / gateway records.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';

export const domain = 'students';

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  await ctx.writeEmptyFor(models);
  ctx.log(domain, `${models.length} empty CSVs written`);
}
