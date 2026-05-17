/**
 * curriculum generator
 *
 * D1: empty CSVs for all 32 curriculum-domain models.
 * D4: ~600 Programmes × ProgrammeVersion (~2,400), ~3,000 Modules ×
 *     ModuleVersion (~12,000), learning outcomes, assessment component
 *     definitions, programme/module specifications, curriculum proposals
 *     across 5 years of curriculum-approval workflow.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';

export const domain = 'curriculum';

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  await ctx.writeEmptyFor(models);
  ctx.log(domain, `${models.length} empty CSVs written`);
}
