import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

// ── Mock dependencies before importing the service under test ──────────────
vi.mock('../../repositories/hesaNotification.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
}));
vi.mock('../../repositories/hesaReturn.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  findActiveByYear: vi.fn(),
}));
vi.mock('../../repositories/hesaSnapshot.repository', () => ({
  create: vi.fn(),
  getById: vi.fn(),
  list: vi.fn(),
  replaceForReturn: vi.fn(),
  findByReturnId: vi.fn(),
}));
vi.mock('../../repositories/hesaValidationRule.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  getByCode: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  findAllActive: vi.fn(),
  findActiveByEntityType: vi.fn(),
}));
vi.mock('../../repositories/hesaStudent.repository', () => ({
  findAll: vi.fn(),
  getById: vi.fn(),
  findActiveForAcademicYear: vi.fn(),
}));
vi.mock('../../repositories/hesaModule.repository', () => ({
  findByAcademicYear: vi.fn(),
  getById: vi.fn(),
}));
vi.mock('../../repositories/programme.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as hesaService from '../../api/hesa/hesa.service';
import * as hesaReturnRepo from '../../repositories/hesaReturn.repository';
import * as hesaSnapshotRepo from '../../repositories/hesaSnapshot.repository';
import * as hesaValidationRuleRepo from '../../repositories/hesaValidationRule.repository';
import * as hesaStudentRepo from '../../repositories/hesaStudent.repository';
import * as hesaModuleRepo from '../../repositories/hesaModule.repository';
import * as programmeRepo from '../../repositories/programme.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedReturnRepo = vi.mocked(hesaReturnRepo);
const mockedSnapshotRepo = vi.mocked(hesaSnapshotRepo);
const mockedRuleRepo = vi.mocked(hesaValidationRuleRepo);
const mockedStudentRepo = vi.mocked(hesaStudentRepo);
const mockedModuleRepo = vi.mocked(hesaModuleRepo);
const mockedProgrammeRepo = vi.mocked(programmeRepo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

const findEvent = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? c[0] : null))
    .find((e) => e && (e as { event?: string }).event === eventName);

const fakeStudent = {
  id: 'hs-1',
  studentId: 'stu-1',
  husid: '202500001',
  ownstu: 'STU-001',
  ttaccom: '01',
  disable: '00',
  ethnic: '15',
  sexort: '01',
  relblf: '02',
  genderid: '10',
  nation: 'GB',
  domicile: 'XF',
  socClass: '1',
  sec: '1.1',
  postcode: 'SW1A 1AA',
  comdate: new Date('2025-09-01'),
  enddate: null,
  hesaData: null,
};

const fakeModule = {
  id: 'hm-1',
  moduleId: 'mod-1',
  academicYear: '2025/26',
  modId: 'CS101-2025',
  crdtPts: 30,
  crdtScm: 'ENG',
  levlpts: '4',
  fte: 0.25,
  pcolab: 0,
  hesaData: null,
};

const fakeProgramme = {
  id: 'prog-1',
  programmeCode: 'BSC-CS-001',
  title: 'BSc Computer Science',
  level: 'LEVEL_6',
  awardingBody: 'Future Horizons Education',
};

const fakeRule = {
  id: 'rule-1',
  ruleCode: 'HESA-STD-001',
  description: 'HUSID is required',
  entityType: 'HESAStudent',
  fieldName: 'HUSID',
  validationType: 'REQUIRED',
  expectedValues: null,
  severity: 'ERROR' as const,
  isActive: true,
};

const fakeReturn = {
  id: 'ret-1',
  academicYear: '2025/26',
  returnType: 'STUDENT',
  status: 'PREPARATION',
  recordCount: 0,
  validationErrors: null,
};

describe('hesa.service.composeReturn', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedStudentRepo.findActiveForAcademicYear.mockResolvedValue([fakeStudent] as any);
    mockedModuleRepo.findByAcademicYear.mockResolvedValue([fakeModule] as any);
    mockedProgrammeRepo.list.mockResolvedValue({ data: [fakeProgramme], total: 1 } as any);
    mockedRuleRepo.findAllActive.mockResolvedValue([fakeRule] as any);
    mockedReturnRepo.findActiveByYear.mockResolvedValue(null);
    mockedReturnRepo.create.mockResolvedValue(fakeReturn as any);
    mockedReturnRepo.update.mockResolvedValue({ ...fakeReturn, recordCount: 1 } as any);
    mockedSnapshotRepo.replaceForReturn.mockResolvedValue(2);
  });

  it('creates a new HESAReturn header when none exists for (year, type)', async () => {
    await hesaService.composeReturn(
      { academicYear: '2025/26', returnType: 'STUDENT' },
      'user-1',
      fakeReq,
    );
    expect(mockedReturnRepo.create).toHaveBeenCalledTimes(1);
    expect(findEvent('hesa.return_created')).toBeTruthy();
  });

  it('reuses the existing HESAReturn header when one already exists', async () => {
    mockedReturnRepo.findActiveByYear.mockResolvedValue(fakeReturn as any);
    const result = await hesaService.composeReturn(
      { academicYear: '2025/26', returnType: 'STUDENT' },
      'user-1',
      fakeReq,
    );
    expect(mockedReturnRepo.create).not.toHaveBeenCalled();
    expect(result.hesaReturnId).toBe('ret-1');
  });

  it('throws NotFoundError when an explicit returnId does not exist', async () => {
    mockedReturnRepo.getById.mockResolvedValue(null);
    await expect(
      hesaService.composeReturn(
        { academicYear: '2025/26', returnType: 'STUDENT', returnId: 'missing' },
        'user-1',
        fakeReq,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when explicit returnId mismatches academicYear/returnType', async () => {
    mockedReturnRepo.getById.mockResolvedValue({
      id: 'ret-2',
      academicYear: '2024/25',
      returnType: 'STUDENT',
      status: 'PREPARATION',
    } as any);
    await expect(
      hesaService.composeReturn(
        { academicYear: '2025/26', returnType: 'STUDENT', returnId: 'ret-2' },
        'user-1',
        fakeReq,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('persists snapshots and updates the HESAReturn header on a happy path', async () => {
    const result = await hesaService.composeReturn(
      { academicYear: '2025/26', returnType: 'STUDENT' },
      'user-1',
      fakeReq,
    );
    expect(result.persisted).toBe(true);
    expect(mockedSnapshotRepo.replaceForReturn).toHaveBeenCalledTimes(1);
    expect(mockedReturnRepo.update).toHaveBeenCalledWith(
      'ret-1',
      expect.objectContaining({
        recordCount: expect.any(Number),
        status: 'PREPARATION',
      }),
    );
    expect(findEvent('hesa.snapshot_created')).toBeTruthy();
    expect(findEvent('hesa.return_composed')).toBeTruthy();
  });

  it('skips persistence when persist=false but still emits return_composed', async () => {
    const result = await hesaService.composeReturn(
      { academicYear: '2025/26', returnType: 'STUDENT', persist: false },
      'user-1',
      fakeReq,
    );
    expect(result.persisted).toBe(false);
    expect(mockedSnapshotRepo.replaceForReturn).not.toHaveBeenCalled();
    expect(mockedReturnRepo.create).not.toHaveBeenCalled();
    expect(findEvent('hesa.return_composed')).toBeTruthy();
    expect(findEvent('hesa.snapshot_created')).toBeUndefined();
  });

  it('honours an explicit ruleOverride and bypasses repository active rules', async () => {
    await hesaService.composeReturn(
      {
        academicYear: '2025/26',
        returnType: 'STUDENT',
        ruleOverride: [
          {
            id: 'override-1',
            ruleCode: 'OVERRIDE',
            description: 'override',
            entityType: 'HESAStudent',
            fieldName: 'POSTCODE',
            validationType: 'REQUIRED',
            severity: 'WARNING',
            isActive: true,
          },
        ],
      },
      'user-1',
      fakeReq,
    );
    expect(mockedRuleRepo.findAllActive).not.toHaveBeenCalled();
  });

  it('records validation errors on the HESAReturn row when persist=true', async () => {
    mockedStudentRepo.findActiveForAcademicYear.mockResolvedValue([
      { ...fakeStudent, husid: null },
    ] as any);
    await hesaService.composeReturn(
      { academicYear: '2025/26', returnType: 'STUDENT' },
      'user-1',
      fakeReq,
    );
    const updateCall = mockedReturnRepo.update.mock.calls[0]?.[1];
    const errors = (updateCall as { validationErrors?: unknown[] }).validationErrors;
    expect(Array.isArray(errors)).toBe(true);
    expect((errors as unknown[]).length).toBeGreaterThan(0);
  });

  it('audits HESAReturn UPDATE when persist=true', async () => {
    await hesaService.composeReturn(
      { academicYear: '2025/26', returnType: 'STUDENT' },
      'user-1',
      fakeReq,
    );
    const updateAudit = mockedLogAudit.mock.calls.find(
      (call) => call[0] === 'HESAReturn' && call[2] === 'UPDATE',
    );
    expect(updateAudit).toBeTruthy();
  });
});

describe('hesa.service.validateReturn', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedReturnRepo.getById.mockResolvedValue(fakeReturn as any);
    mockedSnapshotRepo.findByReturnId.mockResolvedValue([
      {
        id: 'snap-1',
        hesaReturnId: 'ret-1',
        entityType: 'HESAStudent',
        entityId: 'hs-1',
        snapshotDate: new Date(),
        snapshotData: {
          recordKey: '202500001',
          fields: {
            HUSID: '202500001',
            ETHNIC: '15',
            POSTCODE: 'SW1A 1AA',
          },
          sortOrder: 0,
        },
      },
    ] as any);
    mockedRuleRepo.findAllActive.mockResolvedValue([fakeRule] as any);
    mockedReturnRepo.update.mockResolvedValue({ ...fakeReturn, status: 'VALIDATION' } as any);
  });

  it('throws NotFoundError when the HESAReturn does not exist', async () => {
    mockedReturnRepo.getById.mockResolvedValue(null);
    await expect(
      hesaService.validateReturn('missing', {}, 'user-1', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when the HESAReturn has no snapshot rows', async () => {
    mockedSnapshotRepo.findByReturnId.mockResolvedValue([]);
    await expect(
      hesaService.validateReturn('ret-1', {}, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('returns a validation outcome on a passing snapshot', async () => {
    const result = await hesaService.validateReturn('ret-1', {}, 'user-1', fakeReq);
    expect(result.hesaReturnId).toBe('ret-1');
    expect(result.errorCount).toBe(0);
    expect(result.recordCount).toBe(1);
    expect(findEvent('hesa.return_validated')).toBeTruthy();
  });

  it('captures an ERROR-severity rule failure on a missing required field', async () => {
    mockedSnapshotRepo.findByReturnId.mockResolvedValue([
      {
        id: 'snap-1',
        hesaReturnId: 'ret-1',
        entityType: 'HESAStudent',
        entityId: 'hs-1',
        snapshotDate: new Date(),
        snapshotData: {
          recordKey: 'no-husid',
          fields: { HUSID: null, ETHNIC: '15' },
          sortOrder: 0,
        },
      },
    ] as any);
    const result = await hesaService.validateReturn('ret-1', {}, 'user-1', fakeReq);
    expect(result.errorCount).toBe(1);
    expect(result.validationResults.some((v) => !v.passed)).toBe(true);
  });

  it('does not call HESAReturn.update when persist=false', async () => {
    await hesaService.validateReturn('ret-1', { persist: false }, 'user-1', fakeReq);
    expect(mockedReturnRepo.update).not.toHaveBeenCalled();
  });
});

describe('hesa.service.exportReturn', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedReturnRepo.getById.mockResolvedValue(fakeReturn as any);
    mockedSnapshotRepo.findByReturnId.mockResolvedValue([
      {
        id: 'snap-body',
        hesaReturnId: 'ret-1',
        entityType: 'HESAReturn',
        entityId: '__return_body__',
        snapshotDate: new Date(),
        snapshotData: {
          header: {
            academicYear: '2025/26',
            returnType: 'STUDENT',
            generatedDate: new Date('2026-01-15T09:00:00Z').toISOString(),
            generatedBy: 'user-1',
            columnOrder: ['HUSID', 'ETHNIC'],
          },
          totals: {
            recordCount: 1,
            errorCount: 0,
            warningCount: 0,
            infoCount: 0,
            skippedRuleCount: 0,
          },
          notes: [],
          validationResults: [],
        },
      },
      {
        id: 'snap-1',
        hesaReturnId: 'ret-1',
        entityType: 'HESAStudent',
        entityId: 'hs-1',
        snapshotDate: new Date(),
        snapshotData: {
          recordKey: '202500001',
          fields: { HUSID: '202500001', ETHNIC: '15' },
          sortOrder: 0,
        },
      },
    ] as any);
  });

  it('throws NotFoundError when the HESAReturn does not exist', async () => {
    mockedReturnRepo.getById.mockResolvedValue(null);
    await expect(
      hesaService.exportReturn('missing', 'csv', 'user-1', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when no snapshots exist', async () => {
    mockedSnapshotRepo.findByReturnId.mockResolvedValue([]);
    await expect(
      hesaService.exportReturn('ret-1', 'csv', 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when the body sentinel snapshot is missing', async () => {
    mockedSnapshotRepo.findByReturnId.mockResolvedValue([
      {
        id: 'snap-1',
        hesaReturnId: 'ret-1',
        entityType: 'HESAStudent',
        entityId: 'hs-1',
        snapshotDate: new Date(),
        snapshotData: { recordKey: 'k', fields: {}, sortOrder: 0 },
      },
    ] as any);
    await expect(
      hesaService.exportReturn('ret-1', 'csv', 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects unsupported export formats', async () => {
    await expect(
      hesaService.exportReturn('ret-1', 'xml' as any, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('returns a CSV body with the expected filename and content type', async () => {
    const result = await hesaService.exportReturn('ret-1', 'csv', 'user-1', fakeReq);
    expect(result.format).toBe('csv');
    expect(result.contentType).toContain('text/csv');
    expect(result.filename).toContain('hesa-STUDENT-2025-26');
    expect(result.body).toContain('RecordKey,EntityType,HUSID,ETHNIC');
    expect(result.body).toContain('202500001,HESAStudent,202500001,15');
    expect(findEvent('hesa.return_exported')).toBeTruthy();
  });
});
