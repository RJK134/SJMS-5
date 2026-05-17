/**
 * identity generator
 *
 * D1: empty CSVs for all 27 identity-domain models.
 * D2+: real data — User, Person, Role, Permission, Session, ApiKey,
 *      PersonName, ContactMethod, PersonAddress, EmergencyContact,
 *      IdentityDocument, ConsentRecord, LawfulBasisRecord, etc.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';

export const domain = 'identity';

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  await ctx.writeEmptyFor(models);
  ctx.log(domain, `${models.length} empty CSVs written`);
}
