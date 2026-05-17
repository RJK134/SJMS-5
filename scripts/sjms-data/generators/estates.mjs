/**
 * estates generator
 *
 * D1: empty CSVs for all 5 estates-domain models.
 * D2+: Campus, Building, Room (academic + accommodation halls / rooms).
 */

import { modelsByDomain } from '../lib/domain-map.mjs';

export const domain = 'estates';

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  await ctx.writeEmptyFor(models);
  ctx.log(domain, `${models.length} empty CSVs written`);
}
