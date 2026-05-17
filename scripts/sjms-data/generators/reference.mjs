/**
 * reference generator
 *
 * D1: empty CSVs for all 14 reference-domain models.
 * D2+: HESA cost centres, HECOS subject codes, SOC codes, AcademicYear,
 *      DocumentTemplate, CommunicationTemplate. Foundation reference data
 *      every downstream domain depends on.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';

export const domain = 'reference';

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  await ctx.writeEmptyFor(models);
  ctx.log(domain, `${models.length} empty CSVs written`);
}
