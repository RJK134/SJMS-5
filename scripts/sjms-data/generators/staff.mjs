/**
 * staff generator
 *
 * D1: empty CSVs for all 6 staff-domain models.
 * D3: 1000 active Staff with StaffRecord + StaffContract chain across 5 years,
 *     ~1200 contracts total, StaffQualifications, ExternalExaminer
 *     appointments. Distribution per uk-demographics.STAFF_CATEGORIES_WEIGHTED.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';

export const domain = 'staff';

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  await ctx.writeEmptyFor(models);
  ctx.log(domain, `${models.length} empty CSVs written`);
}
