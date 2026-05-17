/**
 * governance generator (D2)
 *
 * - 6 Faculty rows (matching uk-uni-skeleton.FACULTIES)
 * - 48 Department rows (8 per faculty)
 * - 48 DepartmentCostCentre junctions (one per dept → matching HESA cost centre)
 * - Committees per uk-uni-skeleton.STANDING_COMMITTEES + facultyBoards():
 *     14 institution-wide + 18 faculty-level = 32 committees
 * - CommitteeMembers (~400 across all committees)
 * - CommitteeMeetings (5 years × cadence per committee → ~1,200 meetings)
 * - CommitteeActionItems (~2 per meeting → ~2,400)
 * - StudentOrganisation (~40)
 * - StudentOrgMembership / StudentOrgEvent populated in D6/D7 when students exist
 * - CoCurricularRecord declared empty here; populated in D6 once studentIds available
 */

import { modelsByDomain } from '../lib/domain-map.mjs';
import {
  FACULTIES, ALL_DEPARTMENTS, STANDING_COMMITTEES, facultyBoards, INSTITUTION,
} from '../lib/uk-uni-skeleton.mjs';
import { FIRST_NAMES, LAST_NAMES } from '../lib/uk-demographics.mjs';
import { ACADEMIC_YEARS, ayStartDate } from '../lib/academic-calendar.mjs';

export const domain = 'governance';

const STUDENT_ORG_TYPES = [
  ['ACADEMIC',   'Academic society'],
  ['SPORTS',     'Sports club'],
  ['CULTURAL',   'Cultural society'],
  ['VOLUNTEERING','Volunteering / community'],
  ['POLITICAL',  'Political / debating'],
  ['MEDIA',      'Student media'],
  ['FAITH',      'Faith group'],
  ['ENTERPRISE', 'Entrepreneurial society'],
];

const STUDENT_ORG_SEEDS = [
  ['Football Club',     'SPORTS'], ['Rugby Club',     'SPORTS'],
  ['Hockey Club',       'SPORTS'], ['Cricket Club',   'SPORTS'],
  ['Athletics Club',    'SPORTS'], ['Swimming Club',  'SPORTS'],
  ['Rowing Club',       'SPORTS'], ['Climbing Club',  'SPORTS'],
  ['Debating Society',  'POLITICAL'], ['Politics Society', 'POLITICAL'],
  ['Law Society',       'ACADEMIC'], ['Medical Society','ACADEMIC'],
  ['Engineering Society','ACADEMIC'],['Computer Science Society','ACADEMIC'],
  ['Drama Society',     'CULTURAL'], ['Music Society',  'CULTURAL'],
  ['Art Society',       'CULTURAL'], ['Film Society',   'CULTURAL'],
  ['Literature Society','CULTURAL'], ['Photography Society','CULTURAL'],
  ['African-Caribbean Society','CULTURAL'], ['Asian Society','CULTURAL'],
  ['Latin American Society','CULTURAL'], ['LGBTQ+ Society','CULTURAL'],
  ['Student Volunteers','VOLUNTEERING'], ['RAG Society','VOLUNTEERING'],
  ['Habitat for Humanity','VOLUNTEERING'], ['Amnesty International','VOLUNTEERING'],
  ['Christian Union',   'FAITH'],    ['Islamic Society','FAITH'],
  ['Jewish Society',    'FAITH'],    ['Hindu Society',  'FAITH'],
  ['Sikh Society',      'FAITH'],    ['Catholic Society','FAITH'],
  ['Enterprise Society','ENTERPRISE'], ['Investment Society','ENTERPRISE'],
  ['Student Newspaper', 'MEDIA'],    ['Student Radio',  'MEDIA'],
  ['Student TV',        'MEDIA'],    ['Yearbook Society','MEDIA'],
];

function pickName(rng) {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

function emailFor(name) {
  return name.toLowerCase()
    .replace(/[^a-z\s.]/g, '').replace(/\s+/g, '.').replace(/\.+/g, '.')
    + '@fhe.ac.uk';
}

function meetingsPerYearFor(frequency) {
  switch (frequency) {
    case 'WEEKLY':      return 38;     // term-time only
    case 'FORTNIGHTLY': return 19;
    case 'MONTHLY':     return 10;
    case 'TERMLY':      return 3;
    case 'ANNUALLY':    return 1;
    case 'AD_HOC':      return 2;
    default:            return 3;
  }
}

function locateHesaCostCentreFor(hecos, hesaCostCentres) {
  // crude mapping — use the first cost centre with a matching group prefix
  if (!hesaCostCentres.length) return hesaCostCentres[0]?.id ?? null;
  return hesaCostCentres[Math.abs(parseInt(hecos, 10)) % hesaCostCentres.length].id;
}

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  const now = new Date('2026-05-17T08:00:00Z').toISOString();
  const rng = ctx.rng.fork('governance');

  // 1. Faculty rows
  const facultyRows = FACULTIES.map((f) => {
    const id = `fac-${f.code.toLowerCase()}`;
    const headName = pickName(rng);
    ctx.ids.facultyByCode.set(f.code, { id, code: f.code, name: f.name, headName });
    return {
      id, ...ctx.audit(now),
      name: f.name, code: f.code,
      headOfFaculty: `Dean ${headName}`,
      email: `dean.${f.code.toLowerCase()}@${INSTITUTION.domain}`,
      phone: `020 7946 ${1000 + rng.int(0, 8999)}`,
      description: `${f.name} — overseeing ${f.departments.length} departments and ~7,000 students across UG, PGT and PGR provision.`,
    };
  });
  ctx.append('Faculty', facultyRows);

  // 2. Department rows
  const departmentRows = [];
  for (const d of ALL_DEPARTMENTS) {
    const facultyId = ctx.ids.facultyByCode.get(d.facultyCode).id;
    const id = `dept-${d.code.toLowerCase()}`;
    const headName = pickName(rng);
    ctx.ids.departmentByCode.set(d.code, {
      id, code: d.code, name: d.name, facultyCode: d.facultyCode,
      facultyId, hecos: d.hecos, headName,
    });
    departmentRows.push({
      id, ...ctx.audit(now),
      name: d.name, code: d.code, facultyId,
      headOfDepartment: `Prof. ${headName}`,
      email: `${d.code.toLowerCase()}@${INSTITUTION.domain}`,
      phone: `020 7946 ${1000 + rng.int(0, 8999)}`,
      description: `${d.name} (HECOS ${d.hecos}) — primary teaching and research department within the ${ctx.ids.facultyByCode.get(d.facultyCode).name}.`,
    });
  }
  ctx.append('Department', departmentRows);

  // 3. DepartmentCostCentre — link each dept to a HESA cost centre
  ctx.append('DepartmentCostCentre', [...ctx.ids.departmentByCode.values()].map((d) => ({
    id: `dcc-${d.code.toLowerCase()}`,
    createdAt: now, updatedAt: now,
    departmentId: d.id,
    costCentreId: locateHesaCostCentreFor(d.hecos, ctx.ids.hesaCostCentres),
    proportion: '1.00', academicYearId: null,
  })));

  // 4. Committees — institution-wide + faculty-level
  const committeeRows = [];
  const committeeRefs = [];           // { id, name, meetingFrequency, facultyCode? }
  for (const c of STANDING_COMMITTEES) {
    const id = `cmt-${c.name.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    const chairName = pickName(rng);
    const secName = pickName(rng);
    committeeRefs.push({ id, name: c.name, meetingFrequency: c.meetingFrequency, facultyCode: null });
    committeeRows.push({
      id, ...ctx.audit(now),
      name: c.name, committeeType: c.committeeType, parentId: null,
      chairName, chairEmail: emailFor(chairName),
      secretaryName: secName, secretaryEmail: emailFor(secName),
      meetingFrequency: c.meetingFrequency,
      termsOfReference: `https://intranet.${INSTITUTION.domain}/committees/${id}/tor`,
      isActive: true,
    });
  }
  for (const c of facultyBoards()) {
    const id = `cmt-${c.facultyCode.toLowerCase()}-${c.name.toLowerCase().replace(/[^a-z]+/g, '-').slice(0, 40)}`;
    const chairName = pickName(rng);
    const secName = pickName(rng);
    committeeRefs.push({ id, name: c.name, meetingFrequency: c.meetingFrequency, facultyCode: c.facultyCode });
    committeeRows.push({
      id, ...ctx.audit(now),
      name: c.name, committeeType: c.committeeType,
      parentId: ctx.ids.facultyByCode.get(c.facultyCode).id,
      chairName, chairEmail: emailFor(chairName),
      secretaryName: secName, secretaryEmail: emailFor(secName),
      meetingFrequency: c.meetingFrequency,
      termsOfReference: `https://intranet.${INSTITUTION.domain}/committees/${id}/tor`,
      isActive: true,
    });
  }
  ctx.append('Committee', committeeRows);

  // 5. CommitteeMember rows — 10–15 members per committee
  const memberRows = [];
  for (const c of committeeRefs) {
    const memberCount = rng.int(10, 18);
    for (let i = 0; i < memberCount; i++) {
      const name = pickName(rng);
      const role = i === 0 ? 'CHAIR' : i === 1 ? 'SECRETARY'
        : i === 2 ? 'VICE_CHAIR' : 'MEMBER';
      memberRows.push({
        id: `cmm-${c.id.slice(4)}-${i.toString().padStart(2, '0')}`,
        ...ctx.audit(now),
        committeeId: c.id, memberName: name, memberEmail: emailFor(name),
        memberRole: role,
        startDate: ayStartDate('2023/24') + 'T00:00:00Z', endDate: null,
        isActive: true,
      });
    }
  }
  ctx.append('CommitteeMember', memberRows);

  // 6. Meetings — meetingsPerYearFor(frequency) × 5 academic years
  const meetingRows = [];
  for (const c of committeeRefs) {
    const perYear = meetingsPerYearFor(c.meetingFrequency);
    for (const ayLabel of ACADEMIC_YEARS.slice(0, 6)) {     // 2020/21 .. 2025/26 (skip 2026/27 future)
      const ayStart = new Date(ayStartDate(ayLabel) + 'T10:00:00Z');
      const intervalDays = Math.floor(365 / perYear);
      for (let m = 0; m < perYear; m++) {
        const meetingDate = new Date(ayStart);
        meetingDate.setUTCDate(meetingDate.getUTCDate() + m * intervalDays);
        if (meetingDate > new Date('2026-05-17')) continue;
        meetingRows.push({
          id: `mtg-${c.id.slice(4)}-${ayLabel.replace('/', '')}-${m.toString().padStart(2, '0')}`,
          ...ctx.audit(now),
          committeeId: c.id,
          meetingDate: meetingDate.toISOString(),
          location: rng.pick(['Council Room', 'Senate Chamber', 'Boardroom A', 'Boardroom B', 'Hybrid']),
          isVirtual: rng.chance(0.3),
          meetingUrl: rng.chance(0.3) ? `https://meet.${INSTITUTION.domain}/${c.id}` : null,
          status: 'COMPLETED',
          agendaUrl: `https://intranet.${INSTITUTION.domain}/committees/${c.id}/meetings/${meetingRows.length + 1}/agenda`,
          minutesUrl: `https://intranet.${INSTITUTION.domain}/committees/${c.id}/meetings/${meetingRows.length + 1}/minutes`,
          attendees: '', apologies: '', quorumMet: rng.chance(0.95),
        });
      }
    }
  }
  ctx.append('CommitteeMeeting', meetingRows);

  // 7. CommitteeActionItem — ~2 per meeting, half open / half completed
  const actionRows = [];
  for (const m of meetingRows) {
    const actions = rng.int(0, 4);
    for (let i = 0; i < actions; i++) {
      const ownerName = pickName(rng);
      const isClosed = rng.chance(0.7);
      const dueDate = new Date(m.meetingDate);
      dueDate.setUTCDate(dueDate.getUTCDate() + rng.int(14, 90));
      actionRows.push({
        id: `act-${m.id.slice(4)}-${i.toString().padStart(1, '0')}`,
        ...ctx.audit(now),
        meetingId: m.id,
        description: rng.pick([
          'Update terms of reference and re-circulate',
          'Liaise with Registry on enrolment numbers',
          'Draft response to OfS condition reporting',
          'Review draft strategic plan',
          'Confirm budget allocation for next AY',
          'Co-ordinate external examiner reports',
          'Report progress to next meeting',
        ]),
        ownerName, ownerEmail: emailFor(ownerName),
        dueDate: dueDate.toISOString(),
        status: isClosed ? 'COMPLETED' : 'OPEN',
        completedDate: isClosed ? dueDate.toISOString() : null,
        notes: null,
        priority: rng.weighted([['HIGH', 15], ['MEDIUM', 60], ['LOW', 25]]),
      });
    }
  }
  ctx.append('CommitteeActionItem', actionRows);

  // 8. Student organisations (the seeded ~40)
  const orgRows = STUDENT_ORG_SEEDS.map(([orgName, orgType], i) => {
    const id = `sorg-${orgName.toLowerCase().replace(/[^a-z]+/g, '-').slice(0, 50)}`;
    const presName = pickName(rng);
    return {
      id, ...ctx.audit(now),
      name: orgName, orgType,
      description: `${orgName} — ${STUDENT_ORG_TYPES.find(t => t[0] === orgType)?.[1] ?? 'Student organisation'}.`,
      presidentName: presName, presidentEmail: emailFor(presName),
      staffAdvisorId: null,    // populated in D3 when staff exists (optional)
      memberCount: 0,          // updated in D6 when memberships are created
      isActive: true,
      affiliations: rng.chance(0.5) ? 'BUCS, NUS' : null,
      annualBudget: rng.int(500, 15000),
      logoUrl: null,
    };
  });
  ctx.append('StudentOrganisation', orgRows);

  // 9. StudentOrgMembership / StudentOrgEvent / CoCurricularRecord declared, filled later.

  ctx.log(domain,
    `${facultyRows.length} faculties, ${departmentRows.length} departments, ${committeeRows.length} committees, ${memberRows.length} members, ${meetingRows.length} meetings, ${actionRows.length} actions, ${orgRows.length} student orgs`);
}
