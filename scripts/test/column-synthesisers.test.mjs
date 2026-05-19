/**
 * column-synthesisers — phase D0 follow-up (passes 1 + 2).
 *
 * Tests:
 *   - synthesisableFields returns the right column set per SJMS-5 model
 *   - applySynthesisers fills missing columns from another column / lookup / stub
 *   - applySynthesisers leaves an existing CSV value intact (CSV value wins)
 *   - loadSynthContext reads the auxiliary CSVs (pass-1 + pass-2 set)
 *   - loadSynthContext tolerates missing files (returns empty maps)
 *   - classifyTables treats synthesisable columns as "available" for the
 *     shape check (a model whose CSV lacks a required column moves from
 *     skippedShape to covered when a synthesiser exists)
 *   - Pass-2 entries: ConsentRecord / StudentInstance / Student /
 *     EngagementScore / ProgressionRecord / Assessment /
 *     AssessmentCriteria / Document / Applicant / Application /
 *     RoomBooking / Certificate / AccommodationBooking / Faculty / Room /
 *     Committee / StaffContract / StaffQualification.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  COLUMN_SYNTHESISERS,
  synthesisableFields,
  applySynthesisers,
  loadSynthContext,
} from '../sjms-data/lib/column-synthesisers.mjs';
import { classifyTables } from '../import-sjms-dataset.mjs';
import { writeCsv } from '../sjms-data/lib/csv-writer.mjs';

describe('synthesisableFields', () => {
  it('returns the configured field set for a known model', () => {
    expect(synthesisableFields('AcademicYear')).toEqual(new Set(['yearCode']));
    expect(synthesisableFields('User')).toEqual(new Set(['keycloakId']));
  });

  it('returns an empty set for an unknown model', () => {
    expect(synthesisableFields('NonExistentModel')).toEqual(new Set());
  });

  it('covers the top-10 shape-gap targets (pass 1)', () => {
    const targets = [
      'AcademicYear', 'User', 'Person', 'PersonName', 'PersonAddress',
      'PersonNationality', 'Programme', 'Module', 'Enrolment', 'ModuleRegistration',
    ];
    for (const t of targets) {
      expect(synthesisableFields(t).size, `${t} has no synthesiser`).toBeGreaterThan(0);
    }
  });

  it('covers the pass-2 shape-gap targets', () => {
    const targets = [
      'Student', 'ConsentRecord', 'StudentInstance', 'EngagementScore',
      'ProgressionRecord', 'Assessment', 'AssessmentCriteria', 'Document',
      'Applicant', 'Application', 'RoomBooking', 'Certificate',
      'AccommodationBooking', 'Faculty', 'Room', 'Committee',
      'StaffContract', 'StaffQualification',
    ];
    for (const t of targets) {
      expect(synthesisableFields(t).size, `${t} has no synthesiser`).toBeGreaterThan(0);
    }
  });
});

describe('applySynthesisers — pass 1', () => {
  it('aliases column names (AcademicYear.yearCode <- year)', () => {
    const row = { id: 'ay-2025-26', year: '2025/26' };
    applySynthesisers('AcademicYear', row, {});
    expect(row.yearCode).toBe('2025/26');
  });

  it('stubs a constant (User.keycloakId)', () => {
    const row = { id: 'user-vc' };
    applySynthesisers('User', row, {});
    expect(row.keycloakId).toBe('kc-user-vc');
  });

  it('looks up auxiliary data (Person.firstName/lastName via personNames map)', () => {
    const row = { id: 'p-00000042' };
    const synthCtx = {
      personNames: new Map([['p-00000042', { firstName: 'Ada', lastName: 'Lovelace' }]]),
    };
    applySynthesisers('Person', row, synthCtx);
    expect(row.firstName).toBe('Ada');
    expect(row.lastName).toBe('Lovelace');
  });

  it('falls back to stubs when an auxiliary lookup misses', () => {
    const row = { id: 'p-99999999' };
    applySynthesisers('Person', row, { personNames: new Map() });
    expect(row.firstName).toBe('Unknown');
    expect(row.lastName).toBe('Person');
  });

  it('preserves an existing non-empty CSV value (CSV wins)', () => {
    const row = { id: 'ay-2025-26', year: '2025/26', yearCode: 'PRE-EXISTING' };
    applySynthesisers('AcademicYear', row, {});
    expect(row.yearCode).toBe('PRE-EXISTING');
  });

  it('overwrites an empty string (treated as missing)', () => {
    const row = { id: 'ay-2025-26', year: '2025/26', yearCode: '' };
    applySynthesisers('AcademicYear', row, {});
    expect(row.yearCode).toBe('2025/26');
  });

  it('derives PersonAddress.personId from a composite id', () => {
    const row = {
      id: 'p-00000042-a1', line1: '10 Downing St', createdAt: '2026-01-01T00:00:00Z',
    };
    applySynthesisers('PersonAddress', row, {});
    expect(row.personId).toBe('p-00000042');
    expect(row.addressLine1).toBe('10 Downing St');
    expect(row.addressType).toBe('HOME');
    expect(row.startDate).toBe('2026-01-01T00:00:00Z');
  });

  it('maps Programme.level from numeric fheqLevel to ProgrammeLevel enum', () => {
    const ug = { id: 'prog-1', code: 'BSC01', name: 'BSc Maths', fheqLevel: '6' };
    applySynthesisers('Programme', ug, {});
    expect(ug.programmeCode).toBe('BSC01');
    expect(ug.title).toBe('BSc Maths');
    expect(ug.level).toBe('LEVEL_6');
    expect(ug.creditTotal).toBe('360');

    const pgr = { id: 'prog-2', code: 'PHD01', name: 'PhD Maths', fheqLevel: '8' };
    applySynthesisers('Programme', pgr, {});
    expect(pgr.level).toBe('LEVEL_8');
    expect(pgr.creditTotal).toBe('540');
  });

  it('resolves Enrolment.academicYear via the academic-year map', () => {
    const row = {
      id: 'en-1', academicYearId: 'ay-2025-26',
      yearOfProgramme: '2', enrolmentDate: '2025-09-29T00:00:00Z',
    };
    const synthCtx = { academicYears: new Map([['ay-2025-26', '2025/26']]) };
    applySynthesisers('Enrolment', row, synthCtx);
    expect(row.academicYear).toBe('2025/26');
    expect(row.yearOfStudy).toBe('2');
    expect(row.startDate).toBe('2025-09-29T00:00:00Z');
    expect(row.feeStatus).toBe('HOME');
  });

  it('is a no-op for a model with no synthesiser', () => {
    const before = { id: 'x', foo: 'bar' };
    const after = applySynthesisers('NotInTheMap', { ...before }, {});
    expect(after).toEqual(before);
  });
});

describe('applySynthesisers — pass 2', () => {
  it('Student: maps feeEligibility -> feeStatus and stubs entryRoute', () => {
    const home = { id: 'stu-1', feeEligibility: 'HOME', createdAt: '2024-09-01T00:00:00Z' };
    applySynthesisers('Student', home, {
      firstEnrolmentDateByStudent: new Map([['stu-1', '2024-09-15T00:00:00Z']]),
    });
    expect(home.feeStatus).toBe('HOME');
    expect(home.entryRoute).toBe('UCAS');
    expect(home.originalEntryDate).toBe('2024-09-15T00:00:00Z');

    const overseas = { id: 'stu-2', feeEligibility: 'OVERSEAS', createdAt: '2024-09-01' };
    applySynthesisers('Student', overseas, {});
    expect(overseas.feeStatus).toBe('OVERSEAS');
    expect(overseas.originalEntryDate).toBe('2024-09-01');

    const eu = { id: 'stu-3', feeEligibility: 'EU_REINSTATED', createdAt: '2024-09-01' };
    applySynthesisers('Student', eu, {});
    expect(eu.feeStatus).toBe('EU_TRANSITIONAL');
  });

  it('ConsentRecord: resolves studentId via personId map and maps consent purpose', () => {
    const synthCtx = {
      studentIdByPersonId: new Map([['p-00000042', 'stu-42']]),
    };
    const row = { id: 'cr-1', personId: 'p-00000042', purpose: 'ACADEMIC_ASSESSMENT' };
    applySynthesisers('ConsentRecord', row, synthCtx);
    expect(row.studentId).toBe('stu-42');
    expect(row.consentType).toBe('DATA_SHARING');

    const marketing = { id: 'cr-2', personId: 'p-00000042', purpose: 'MARKETING_COMMUNICATIONS' };
    applySynthesisers('ConsentRecord', marketing, synthCtx);
    expect(marketing.consentType).toBe('MARKETING');

    const alumni = { id: 'cr-3', personId: 'p-00000042', purpose: 'ALUMNI_RELATIONS' };
    applySynthesisers('ConsentRecord', alumni, synthCtx);
    expect(alumni.consentType).toBe('ALUMNI');
  });

  it('StudentInstance: derives studentId/programmeId/academicYearId from enrolment map', () => {
    const synthCtx = {
      enrolments: new Map([
        ['en-1', {
          studentId: 'stu-1',
          programmeId: 'prog-eng',
          academicYearId: 'ay-2025-26',
          yearOfProgramme: '2',
        }],
      ]),
    };
    const row = { id: 'si-1', enrolmentId: 'en-1' };
    applySynthesisers('StudentInstance', row, synthCtx);
    expect(row.studentId).toBe('stu-1');
    expect(row.programmeId).toBe('prog-eng');
    expect(row.academicYearId).toBe('ay-2025-26');
    expect(row.yearOfStudy).toBe('2');
  });

  it('EngagementScore: synthesises academicYear, weekNumber, calculatedDate', () => {
    const synthCtx = { academicYears: new Map([['ay-2025-26', '2025/26']]) };
    const row = {
      id: 'es-1', studentId: 'stu-1', academicYearId: 'ay-2025-26',
      calculatedDate: '2025-10-15T00:00:00Z',
    };
    applySynthesisers('EngagementScore', row, synthCtx);
    expect(row.academicYear).toBe('2025/26');
    expect(Number(row.weekNumber)).toBeGreaterThan(0);
    expect(Number(row.weekNumber)).toBeLessThan(54);
    expect(row.calculatedDate).toBe('2025-10-15T00:00:00Z');

    // empty calculatedDate falls back to createdAt
    const empty = {
      id: 'es-2', studentId: 'stu-1', academicYearId: 'ay-2025-26',
      calculatedDate: '', createdAt: '2025-09-29T00:00:00Z',
    };
    applySynthesisers('EngagementScore', empty, synthCtx);
    expect(empty.calculatedDate).toBe('2025-09-29T00:00:00Z');
  });

  it('ProgressionRecord: derives academicYear, yearOfStudy, decision, credits', () => {
    const synthCtx = {
      academicYears: new Map([['ay-2024-25', '2024/25']]),
      enrolments: new Map([['en-1', {
        studentId: 'stu-1', programmeId: 'p', academicYearId: 'ay-2024-25', yearOfProgramme: '3',
      }]]),
    };
    const row = {
      id: 'pr-1', enrolmentId: 'en-1', academicYearId: 'ay-2024-25',
      decision: 'PROGRESS_TO_NEXT_YEAR', credits: '120',
    };
    applySynthesisers('ProgressionRecord', row, synthCtx);
    expect(row.academicYear).toBe('2024/25');
    expect(row.yearOfStudy).toBe('3');
    expect(row.totalCreditsAttempted).toBe('120');
    expect(row.totalCreditsPassed).toBe('120');
    expect(row.progressionDecision).toBe('PROGRESS');
  });

  it('Assessment: synthesises academicYear, weighting, maxMark', () => {
    const synthCtx = { academicYears: new Map([['ay-2025-26', '2025/26']]) };
    const row = {
      id: 'a-1', moduleId: 'mod-1', academicYearId: 'ay-2025-26',
      title: 'Coursework', assessmentType: 'COURSEWORK',
    };
    applySynthesisers('Assessment', row, synthCtx);
    expect(row.academicYear).toBe('2025/26');
    expect(row.weighting).toBe('50');
    expect(row.maxMark).toBe('100');

    // CSV-supplied values win
    const explicit = {
      id: 'a-2', moduleId: 'mod-1', academicYearId: 'ay-2025-26',
      weight: '40', maximumMark: '80',
    };
    applySynthesisers('Assessment', explicit, synthCtx);
    expect(explicit.weighting).toBe('40');
    expect(explicit.maxMark).toBe('80');
  });

  it('AssessmentCriteria: resolves assessmentId via component lookup', () => {
    const synthCtx = {
      assessmentIdByComponentId: new Map([['comp-1', 'assess-1']]),
    };
    const row = { id: 'ac-1', componentId: 'comp-1', description: 'Short rubric line' };
    applySynthesisers('AssessmentCriteria', row, synthCtx);
    expect(row.assessmentId).toBe('assess-1');
    expect(row.title).toBe('Short rubric line');
    expect(row.maxMark).toBe('100');

    // Long description gets sliced to a 60-char title.
    const long = {
      id: 'ac-2', componentId: 'comp-1',
      description: 'A very long rubric description that goes on for definitely more than sixty characters so the title is truncated',
    };
    applySynthesisers('AssessmentCriteria', long, synthCtx);
    expect(long.title.length).toBe(60);
  });

  it('Document: aliases title <- fileName and filePath <- fileUrl', () => {
    const row = { id: 'd-1', fileName: 'transcript.pdf', fileUrl: 'minio://docs/transcript.pdf' };
    applySynthesisers('Document', row, {});
    expect(row.title).toBe('transcript.pdf');
    expect(row.filePath).toBe('minio://docs/transcript.pdf');
  });

  it('Applicant: stubs applicantNumber from id, applicationRoute UCAS', () => {
    const row = { id: 'app-001', personId: 'p-001' };
    applySynthesisers('Applicant', row, {});
    expect(row.applicantNumber).toBe('app-001');
    expect(row.applicationRoute).toBe('UCAS');
  });

  it('Application: derives academicYear from applicationDate (UK Sept-Aug cycle)', () => {
    const synthCtx = { academicYears: new Map([['ay-2025-26', '2025/26'], ['ay-2024-25', '2024/25']]) };

    const oct = { id: 'app-1', applicantId: 'a-1', programmeId: 'p-1', applicationDate: '2025-11-29T00:00:00Z' };
    applySynthesisers('Application', oct, synthCtx);
    expect(oct.academicYear).toBe('2025/26');
    expect(oct.applicationRoute).toBe('UCAS');

    const aug = { id: 'app-2', applicantId: 'a-2', programmeId: 'p-1', applicationDate: '2025-07-15T00:00:00Z' };
    applySynthesisers('Application', aug, synthCtx);
    expect(aug.academicYear).toBe('2024/25');
  });

  it('RoomBooking: aliases date <- bookingDate', () => {
    const row = { id: 'rb-1', roomId: 'r-1', bookingDate: '2025-10-01T09:00:00Z' };
    applySynthesisers('RoomBooking', row, {});
    expect(row.date).toBe('2025-10-01T09:00:00Z');
  });

  it('Certificate: resolves studentId via graduand map, aliases certNumber/issueDate', () => {
    const synthCtx = { studentIdByGraduandId: new Map([['grand-stu-2060001', 'stu-2060001']]) };
    const row = {
      id: 'cert-1', graduandId: 'grand-stu-2060001',
      serialNumber: 'FHU-202021-000001', issuedDate: '2021-08-31T00:00:00Z',
    };
    applySynthesisers('Certificate', row, synthCtx);
    expect(row.studentId).toBe('stu-2060001');
    expect(row.certificateNumber).toBe('FHU-202021-000001');
    expect(row.issueDate).toBe('2021-08-31T00:00:00Z');
  });

  it('AccommodationBooking: aliases startDate/endDate, stubs weeklyRent/totalCost', () => {
    const row = {
      id: 'ab-1', studentId: 'stu-1',
      checkInDate: '2025-09-15T00:00:00Z', checkOutDate: '2026-06-30T00:00:00Z',
    };
    applySynthesisers('AccommodationBooking', row, {});
    expect(row.startDate).toBe('2025-09-15T00:00:00Z');
    expect(row.endDate).toBe('2026-06-30T00:00:00Z');
    expect(row.weeklyRent).toBe('140');
    expect(row.totalCost).toBe('5600');
  });

  it('Faculty / Committee: simple name -> title/committeeName aliases', () => {
    const f = { id: 'fac-1', code: 'AHU', name: 'Faculty of Arts & Humanities' };
    applySynthesisers('Faculty', f, {});
    expect(f.title).toBe('Faculty of Arts & Humanities');

    const c = { id: 'cmt-1', name: 'Senate', committeeType: 'ACADEMIC_BOARD' };
    applySynthesisers('Committee', c, {});
    expect(c.committeeName).toBe('Senate');
  });

  it('Room: aliases roomCode <- code, building <- buildingId', () => {
    const row = { id: 'room-1', code: 'BLD-01-001', buildingId: 'bld-bld-teaching-01', capacity: '50' };
    applySynthesisers('Room', row, {});
    expect(row.roomCode).toBe('BLD-01-001');
    expect(row.building).toBe('bld-bld-teaching-01');
  });

  it('StaffContract / StaffQualification: srec- prefix renamed to staff-', () => {
    const sc = { id: 'cont-1', staffRecordId: 'srec-stf-2020001', contractType: 'PERMANENT' };
    applySynthesisers('StaffContract', sc, {});
    expect(sc.staffId).toBe('staff-stf-2020001');

    const sq = {
      id: 'sq-1', staffRecordId: 'srec-stf-2020001',
      qualificationType: 'PhD', awardingBody: 'Loughborough University',
    };
    applySynthesisers('StaffQualification', sq, {});
    expect(sq.staffId).toBe('staff-stf-2020001');
    expect(sq.qualTitle).toBe('PhD');
    expect(sq.institution).toBe('Loughborough University');
  });
});

describe('loadSynthContext', () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'synthctx-'));
    await writeCsv({
      outDir: dir, table: 'academic_years',
      columns: ['id', 'year'],
      rows: [
        { id: 'ay-2024-25', year: '2024/25' },
        { id: 'ay-2025-26', year: '2025/26' },
      ],
    });
    await writeCsv({
      outDir: dir, table: 'person_names',
      columns: ['id', 'personId', 'firstName', 'lastName'],
      rows: [
        { id: 'p-1-n1', personId: 'p-1', firstName: 'Alice', lastName: 'Smith' },
        { id: 'p-2-n1', personId: 'p-2', firstName: 'Bob', lastName: 'Jones' },
      ],
    });
    await writeCsv({
      outDir: dir, table: 'students',
      columns: ['id', 'personId'],
      rows: [
        { id: 'stu-1', personId: 'p-1' },
        { id: 'stu-2', personId: 'p-2' },
      ],
    });
    await writeCsv({
      outDir: dir, table: 'enrolments',
      columns: ['id', 'studentId', 'programmeId', 'academicYearId', 'yearOfProgramme', 'enrolmentDate'],
      rows: [
        { id: 'en-stu-1-y1', studentId: 'stu-1', programmeId: 'prog-eng', academicYearId: 'ay-2024-25', yearOfProgramme: '1', enrolmentDate: '2024-09-15T00:00:00Z' },
        { id: 'en-stu-1-y2', studentId: 'stu-1', programmeId: 'prog-eng', academicYearId: 'ay-2025-26', yearOfProgramme: '2', enrolmentDate: '2025-09-15T00:00:00Z' },
      ],
    });
    await writeCsv({
      outDir: dir, table: 'assessment_components',
      columns: ['id', 'assessmentId'],
      rows: [{ id: 'comp-1', assessmentId: 'assess-1' }],
    });
    await writeCsv({
      outDir: dir, table: 'graduand_records',
      columns: ['id', 'studentId'],
      rows: [{ id: 'grand-stu-1', studentId: 'stu-1' }],
    });
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('loads academic_years and person_names into maps (pass-1)', async () => {
    const ctx = await loadSynthContext(dir);
    expect(ctx.academicYears.get('ay-2024-25')).toBe('2024/25');
    expect(ctx.academicYears.get('ay-2025-26')).toBe('2025/26');
    expect(ctx.personNames.get('p-1')).toEqual({ firstName: 'Alice', lastName: 'Smith' });
    expect(ctx.personNames.get('p-2')).toEqual({ firstName: 'Bob', lastName: 'Jones' });
  });

  it('loads pass-2 lookups (students, enrolments, components, graduands)', async () => {
    const ctx = await loadSynthContext(dir);
    expect(ctx.studentIdByPersonId.get('p-1')).toBe('stu-1');
    expect(ctx.studentIdByPersonId.get('p-2')).toBe('stu-2');

    expect(ctx.enrolments.get('en-stu-1-y2')).toEqual({
      studentId: 'stu-1',
      programmeId: 'prog-eng',
      academicYearId: 'ay-2025-26',
      yearOfProgramme: '2',
    });

    // earliest-enrolment-date per student
    expect(ctx.firstEnrolmentDateByStudent.get('stu-1')).toBe('2024-09-15T00:00:00Z');

    expect(ctx.assessmentIdByComponentId.get('comp-1')).toBe('assess-1');
    expect(ctx.studentIdByGraduandId.get('grand-stu-1')).toBe('stu-1');
  });

  it('returns empty maps when auxiliary CSVs are absent', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'synthctx-empty-'));
    try {
      const ctx = await loadSynthContext(empty);
      expect(ctx.academicYears.size).toBe(0);
      expect(ctx.personNames.size).toBe(0);
      expect(ctx.studentIdByPersonId.size).toBe(0);
      expect(ctx.enrolments.size).toBe(0);
      expect(ctx.firstEnrolmentDateByStudent.size).toBe(0);
      expect(ctx.assessmentIdByComponentId.size).toBe(0);
      expect(ctx.studentIdByGraduandId.size).toBe(0);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe('classifyTables — synthesiser-aware shape check', () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'synth-classify-'));
    // academic_years CSV has `year` but NOT `yearCode` — the SJMS-5
    // shape check should treat this as covered (synthesiser exists)
    // rather than shape-incompatible.
    await writeCsv({
      outDir: dir, table: 'academic_years',
      columns: ['id', 'year', 'startDate', 'endDate', 'createdAt', 'updatedAt'],
      rows: [{
        id: 'ay-2025-26', year: '2025/26',
        startDate: new Date('2025-09-29'), endDate: new Date('2026-08-31'),
        createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
      }],
    });
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      generatorVersion: '0.1.0', seed: 'synth-test',
      generatedAt: '2026-05-19T00:00:00Z',
      schemaHash: 'synth', schemaModels: 298, totalTables: 1, totalRows: 1,
      rowCounts: { academic_years: 1 },
    }));
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('treats academic_years.yearCode as available via the synthesiser', async () => {
    const schema = {
      models: new Map([
        ['AcademicYear', {
          tableMap: 'academic_years',
          fields: [
            { name: 'id', type: 'String', isEnum: false, isArray: false, isOptional: false, isId: true, isUnique: false, defaultExpr: 'cuid()' },
            { name: 'yearCode', type: 'String', isEnum: false, isArray: false, isOptional: false, isId: false, isUnique: true, defaultExpr: undefined },
            { name: 'startDate', type: 'DateTime', isEnum: false, isArray: false, isOptional: false, isId: false, isUnique: false, defaultExpr: undefined },
            { name: 'endDate', type: 'DateTime', isEnum: false, isArray: false, isOptional: false, isId: false, isUnique: false, defaultExpr: undefined },
            { name: 'createdAt', type: 'DateTime', isEnum: false, isArray: false, isOptional: false, isId: false, isUnique: false, defaultExpr: 'now()' },
            { name: 'updatedAt', type: 'DateTime', isEnum: false, isArray: false, isOptional: false, isId: false, isUnique: false, defaultExpr: 'now()' },
          ],
        }],
      ]),
      enums: new Set(),
    };
    const manifest = {
      schemaHash: 'synth', schemaModels: 298, totalTables: 1, totalRows: 1,
      rowCounts: { academic_years: 1 },
    };
    const c = await classifyTables(dir, manifest, schema);
    const covered = c.covered.find((e) => e.datasetModel === 'AcademicYear');
    expect(covered).toBeDefined();
    expect(covered.importableFields.map((f) => f.name)).toContain('yearCode');
    for (const s of c.skippedShape) {
      expect(s.missingRequired).not.toContain('yearCode');
    }
  });
});

describe('COLUMN_SYNTHESISERS — fixed catalogue', () => {
  it('covers every advertised SJMS-5 model (pass 1 + pass 2)', () => {
    const keys = Object.keys(COLUMN_SYNTHESISERS).sort();
    expect(keys).toEqual([
      'AcademicYear',
      'AccommodationBooking',
      'Applicant',
      'Application',
      'Assessment',
      'AssessmentCriteria',
      'Certificate',
      'Committee',
      'ConsentRecord',
      'Document',
      'EngagementScore',
      'Enrolment',
      'Faculty',
      'Module',
      'ModuleRegistration',
      'Person',
      'PersonAddress',
      'PersonName',
      'PersonNationality',
      'Programme',
      'ProgressionRecord',
      'Room',
      'RoomBooking',
      'StaffContract',
      'StaffQualification',
      'Student',
      'StudentInstance',
      'User',
    ]);
  });
});
