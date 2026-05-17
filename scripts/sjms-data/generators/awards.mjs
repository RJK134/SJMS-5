/**
 * awards generator
 *
 * D1: empty CSVs for all 15 awards-domain models.
 * D8: GraduationCohort per AY, ~8,000 GraduandRecords/yr (40k/5yr UG cohort + PGT),
 *     DegreeAward with classification, Transcript per student-award,
 *     Certificate, GraduationCeremony, plus the Document / DocumentTemplate
 *     / DocumentPermission tail that supports the academic record outputs.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';

export const domain = 'awards';

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  ctx.log(domain, `${models.length} models declared (D1 stub — replaced in later phase)`);
}
