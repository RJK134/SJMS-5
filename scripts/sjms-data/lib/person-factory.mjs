/**
 * Person factory — creates Person + the related PII tables for any natural
 * person (staff member, student, applicant, alumni).
 *
 * Appends rows directly to ctx via ctx.append() and returns the new personId
 * so the caller can FK to it from their primary entity row (Staff/Student/etc).
 *
 * Models populated:
 *   Person, PersonName, ContactMethod (email + phone), PersonAddress,
 *   AddressUsage, PersonNationality, Citizenship, ConsentRecord,
 *   LawfulBasisRecord, optionally SensitiveAttribute + IdentityDocument
 *   (for international staff/students who need visa records).
 */

const CONSENT_PURPOSES = {
  staff: ['ACADEMIC_ASSESSMENT', 'MARKETING_COMMUNICATIONS', 'ALUMNI_RELATIONS', 'RESEARCH_PARTICIPATION'],
  student: ['ACADEMIC_ASSESSMENT', 'STATUTORY_REPORTING', 'ALUMNI_RELATIONS', 'MARKETING_COMMUNICATIONS'],
  applicant: ['ACADEMIC_ASSESSMENT', 'MARKETING_COMMUNICATIONS'],
};

const LAWFUL_BASES = {
  staff: [
    ['employment_administration', 'CONTRACT'],
    ['hesa_staff_return',         'LEGAL_OBLIGATION'],
    ['payroll',                   'CONTRACT'],
    ['training_records',          'CONTRACT'],
  ],
  student: [
    ['enrolment_administration',  'CONTRACT'],
    ['hesa_student_return',       'LEGAL_OBLIGATION'],
    ['ofs_compliance',            'LEGAL_OBLIGATION'],
    ['student_support',           'CONTRACT'],
    ['ukvi_sponsorship',          'LEGAL_OBLIGATION'],
  ],
  applicant: [
    ['admissions_decision',       'CONSENT'],
    ['ucas_data_sharing',         'LEGITIMATE_INTEREST'],
  ],
};

let _personCounter = 0;

function nextPersonId() {
  _personCounter += 1;
  return `p-${_personCounter.toString().padStart(8, '0')}`;
}

/**
 * Reset the person id counter — useful when a test reruns from scratch.
 */
export function resetPersonFactory() {
  _personCounter = 0;
}

/**
 * @param {GeneratorContext} ctx
 * @param {object} attrs
 * @param {string} attrs.role            — 'staff' | 'student' | 'applicant'
 * @param {string} attrs.firstName       — required
 * @param {string} attrs.lastName        — required
 * @param {string} [attrs.middleNames]
 * @param {string} [attrs.title]
 * @param {string} attrs.dateOfBirth     — ISO 'YYYY-MM-DD'
 * @param {string} attrs.gender          — 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY'
 * @param {string} [attrs.hesaSexId]
 * @param {string} attrs.email
 * @param {string} [attrs.phone]
 * @param {string} attrs.nationalityCode — ISO 3166-1 alpha-2
 * @param {string} attrs.address         — { line1, line2?, line3?, city, county?, postcode, country, countryCode }
 * @param {string} attrs.createdAt       — ISO timestamp
 * @param {string} attrs.effectiveFrom   — ISO timestamp the records apply from
 * @returns {{ personId: string, addressId: string }}
 */
export function createPerson(ctx, attrs) {
  const personId = nextPersonId();
  const addressId = `${personId}-a1`;
  const createdAt = attrs.createdAt;
  const effectiveFrom = attrs.effectiveFrom ?? createdAt;
  const audit = ctx.audit(createdAt);

  ctx.append('Person', [{
    id: personId, ...audit,
    dateOfBirth: attrs.dateOfBirth ? attrs.dateOfBirth + 'T00:00:00Z' : null,
    gender: attrs.gender ?? null,
    hesaSexId: attrs.hesaSexId ?? null,
  }]);

  ctx.append('PersonName', [{
    id: `${personId}-n1`, ...audit,
    personId, nameType: 'LEGAL', title: attrs.title ?? null,
    firstName: attrs.firstName,
    middleNames: attrs.middleNames ?? null,
    lastName: attrs.lastName,
    effectiveFrom, effectiveTo: null, isCurrent: true,
  }]);

  ctx.append('ContactMethod', [
    {
      id: `${personId}-c1`, ...audit,
      personId, contactType: 'EMAIL_PERSONAL', value: attrs.email,
      isPrimary: true, isVerified: true,
      verifiedAt: effectiveFrom, effectiveFrom, effectiveTo: null,
    },
    ...(attrs.phone ? [{
      id: `${personId}-c2`, ...audit,
      personId, contactType: 'PHONE_MOBILE', value: attrs.phone,
      isPrimary: false, isVerified: false,
      verifiedAt: null, effectiveFrom, effectiveTo: null,
    }] : []),
  ]);

  ctx.append('PersonAddress', [{
    id: addressId, ...audit,
    line1: attrs.address.line1, line2: attrs.address.line2 ?? null, line3: attrs.address.line3 ?? null,
    city: attrs.address.city, county: attrs.address.county ?? null,
    postcode: attrs.address.postcode, country: attrs.address.country,
    countryCode: attrs.address.countryCode ?? null,
  }]);

  ctx.append('AddressUsage', [{
    id: `${personId}-au1`, ...audit,
    personId, addressId, usageType: 'HOME',
    effectiveFrom, effectiveTo: null,
  }]);

  ctx.append('PersonNationality', [{
    id: `${personId}-pn1`, ...audit,
    personId, nationalityCode: attrs.nationalityCode,
    isPrimary: true, effectiveFrom, effectiveTo: null,
  }]);

  ctx.append('Citizenship', [{
    id: `${personId}-cz1`, ...audit,
    personId, countryCode: attrs.nationalityCode,
    citizenshipType: attrs.nationalityCode === 'GB' ? 'BRITISH' : 'BY_BIRTH',
    effectiveFrom, effectiveTo: null,
  }]);

  // Consent records — one per applicable purpose, all granted at create time
  ctx.append('ConsentRecord', (CONSENT_PURPOSES[attrs.role] ?? []).map((purpose, i) => ({
    id: `${personId}-cr${i + 1}`, ...audit,
    personId, purpose, status: 'GRANTED',
    grantedAt: effectiveFrom, withdrawnAt: null, expiresAt: null, evidenceUrl: null,
  })));

  // Lawful basis records
  ctx.append('LawfulBasisRecord', (LAWFUL_BASES[attrs.role] ?? []).map(([activity, basis], i) => ({
    id: `${personId}-lb${i + 1}`, ...audit,
    personId, processingActivity: activity, lawfulBasis: basis,
    article9Condition: basis === 'LEGAL_OBLIGATION' ? null : null,
    effectiveFrom, effectiveTo: null, reviewDate: null,
  })));

  ctx.ids.personIds.push(personId);
  return { personId, addressId };
}

export function personCount() {
  return _personCounter;
}
