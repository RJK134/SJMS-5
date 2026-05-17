/**
 * governance generator
 *
 * D1: empty CSVs for all 11 governance-domain models.
 * D2: Faculty (6), Department (48), Committee (14 standing + 18 faculty-level),
 *     CommitteeMember (~400), CommitteeMeeting (~200/yr × 5yr), StudentOrganisation
 *     (~40), StudentOrgMembership, StudentOrgEvent, CoCurricularRecord.
 *     Council / Senate / Faculty Boards / Audit / Finance / Education etc. all
 *     emitted as `Committee` instances per the SCHEMA-MAPPING §3 scope rule.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';

export const domain = 'governance';

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  await ctx.writeEmptyFor(models);
  ctx.log(domain, `${models.length} empty CSVs written`);
}
