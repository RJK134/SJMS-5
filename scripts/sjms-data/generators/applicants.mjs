/**
 * applicants generator
 *
 * D1: empty CSVs for all 16 applicant-domain models.
 * D5: 10,000 applicants for cycle 2026/27 with UCAS chain (UcasApplication,
 *     Application, ApplicantQualification, EntryRequirement, Offer,
 *     PersonalStatement, Reference, InterviewSchedule, ClearingApplication
 *     for late entrants). Plus Prospect/ProspectInteraction tail from
 *     marketing/recruitment touchpoints, RecruitmentCampaign + RecruitmentEvent
 *     from the prior 18 months.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';

export const domain = 'applicants';

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  await ctx.writeEmptyFor(models);
  ctx.log(domain, `${models.length} empty CSVs written`);
}
