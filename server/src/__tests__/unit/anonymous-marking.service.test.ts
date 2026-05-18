import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

// ── Mock dependencies before importing the service under test ───────────────
vi.mock('../../repositories/anonymousMarking.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  findByAttempt: vi.fn(),
  revealMarker: vi.fn(),
}));
vi.mock('../../repositories/assessmentAttempt.repository', () => ({
  getById: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as service from '../../api/marks/anonymous-marking.service';
import * as repo from '../../repositories/anonymousMarking.repository';
import * as attemptRepo from '../../repositories/assessmentAttempt.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedAttemptRepo = vi.mocked(attemptRepo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as unknown as Parameters<typeof service.anonymise>[3];

const findEvent = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? c[0] : null))
    .find((e) => e && (e as { event?: string }).event === eventName);

const fakeAttempt = {
  id: 'attempt-1',
  assessmentId: 'assess-1',
  moduleRegistrationId: 'mr-1',
  rawMark: 65,
  status: 'MARKED',
  markedBy: 'first-marker-user',
  attemptNumber: 1,
  createdAt: new Date('2026-03-25'),
  updatedAt: new Date('2026-04-01'),
  deletedAt: null,
  moduleRegistration: {
    id: 'mr-1',
    enrolment: { id: 'enr-1', studentId: 'student-1' },
  },
};

const baseAnonymous = {
  id: 'anon-1',
  assessmentId: 'assess-1',
  studentId: 'student-1',
  anonymousId: 'ANON-A1B2C3',
  revealed: false,
  revealedDate: null,
  createdAt: new Date('2026-04-01T10:00:00Z'),
  updatedAt: new Date('2026-04-01T10:00:00Z'),
  createdBy: 'admissions-officer',
  updatedBy: 'admissions-officer',
};

describe('anonymousMarkingService.anonymise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAttemptRepo.getById.mockResolvedValue(fakeAttempt as unknown as Awaited<ReturnType<typeof attemptRepo.getById>>);
    mockedRepo.findByAttempt.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof repo.findByAttempt>>);
    mockedRepo.create.mockImplementation(async (data: Parameters<typeof repo.create>[0]) => ({
      ...baseAnonymous,
      anonymousId: data.anonymousId,
    } as unknown as Awaited<ReturnType<typeof repo.create>>));
  });

  it('happy path: creates an AnonymousMarking with a fresh anonymousId, audits, emits anonymous_marking.created', async () => {
    const result = await service.anonymise('attempt-1', {}, 'admissions-officer', fakeReq);
    expect(mockedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: 'assess-1',
        studentId: 'student-1',
        revealed: false,
      }),
    );
    expect(result.anonymousId).toMatch(/^ANON-[0-9A-F]{6}$/);

    const created = findEvent('anonymous_marking.created');
    expect(created).toBeDefined();
    expect(created?.data).toEqual(
      expect.objectContaining({
        assessmentAttemptId: 'attempt-1',
        assessmentId: 'assess-1',
        studentId: 'student-1',
        anonymousId: result.anonymousId,
      }),
    );

    expect(mockedLogAudit).toHaveBeenCalledWith(
      'AnonymousMarking',
      result.anonymousMarkingId,
      'CREATE',
      'admissions-officer',
      null,
      expect.any(Object),
      fakeReq,
    );
  });

  it('throws NotFoundError when the AssessmentAttempt does not exist', async () => {
    mockedAttemptRepo.getById.mockResolvedValue(null);
    await expect(
      service.anonymise('missing', {}, 'admissions-officer', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects re-anonymisation for the same (assessment, student) pair without force', async () => {
    mockedRepo.findByAttempt.mockResolvedValue([baseAnonymous] as unknown as Awaited<ReturnType<typeof repo.findByAttempt>>);
    await expect(
      service.anonymise('attempt-1', {}, 'admissions-officer', fakeReq),
    ).rejects.toThrow(ValidationError);
    expect(mockedRepo.create).not.toHaveBeenCalled();
  });

  it('allocates a fresh anonymousId when force:true is supplied (existing row retained)', async () => {
    mockedRepo.findByAttempt.mockResolvedValue([baseAnonymous] as unknown as Awaited<ReturnType<typeof repo.findByAttempt>>);
    const result = await service.anonymise(
      'attempt-1',
      { force: true },
      'admissions-officer',
      fakeReq,
    );
    expect(mockedRepo.create).toHaveBeenCalled();
    expect(result.anonymousId).toMatch(/^ANON-[0-9A-F]{6}$/);
    const created = findEvent('anonymous_marking.created');
    expect(created?.data).toEqual(expect.objectContaining({ force: true }));
  });

  it('retries against the @unique constraint when Prisma returns P2002 collisions', async () => {
    let calls = 0;
    mockedRepo.create.mockImplementation(async (data: Parameters<typeof repo.create>[0]) => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('Unique constraint failed') as Error & { code?: string };
        err.code = 'P2002';
        throw err;
      }
      return { ...baseAnonymous, anonymousId: data.anonymousId } as unknown as Awaited<ReturnType<typeof repo.create>>;
    });
    const result = await service.anonymise('attempt-1', {}, 'admissions-officer', fakeReq);
    expect(calls).toBe(2);
    expect(result.anonymousId).toMatch(/^ANON-[0-9A-F]{6}$/);
  });
});

describe('anonymousMarkingService.reveal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepo.getById.mockResolvedValue(baseAnonymous as unknown as Awaited<ReturnType<typeof repo.getById>>);
    mockedRepo.revealMarker.mockResolvedValue({
      ...baseAnonymous,
      revealed: true,
      revealedDate: new Date('2026-04-05T10:00:00Z'),
      updatedBy: 'registry-officer',
    } as unknown as Awaited<ReturnType<typeof repo.revealMarker>>);
  });

  it('happy path: flips revealed=true, stamps revealedDate, audits, emits anonymous_marking.revealed', async () => {
    const result = await service.reveal(
      'anon-1',
      { justification: 'Required for board minutes preparation.' },
      'registry-officer',
      fakeReq,
    );
    expect(mockedRepo.revealMarker).toHaveBeenCalledWith('anon-1', 'registry-officer');
    expect(result.revealedBy).toBe('registry-officer');
    expect(result.revealedDate).toBeInstanceOf(Date);

    const revealed = findEvent('anonymous_marking.revealed');
    expect(revealed).toBeDefined();
    expect(revealed?.data).toEqual(
      expect.objectContaining({
        assessmentId: 'assess-1',
        studentId: 'student-1',
        anonymousId: 'ANON-A1B2C3',
        revealedBy: 'registry-officer',
        justification: 'Required for board minutes preparation.',
      }),
    );

    expect(mockedLogAudit).toHaveBeenCalledWith(
      'AnonymousMarking',
      'anon-1',
      'UPDATE',
      'registry-officer',
      expect.any(Object),
      expect.objectContaining({
        _justification: 'Required for board minutes preparation.',
        _revealedBy: 'registry-officer',
      }),
      fakeReq,
    );
  });

  it('rejects an empty / whitespace-only justification', async () => {
    await expect(
      service.reveal('anon-1', { justification: '   ' }, 'registry-officer', fakeReq),
    ).rejects.toThrow(ValidationError);
    expect(mockedRepo.revealMarker).not.toHaveBeenCalled();
  });

  it('rejects re-revealing an already-revealed AnonymousMarking', async () => {
    mockedRepo.getById.mockResolvedValue({
      ...baseAnonymous,
      revealed: true,
      revealedDate: new Date('2026-04-05T10:00:00Z'),
    } as unknown as Awaited<ReturnType<typeof repo.getById>>);
    await expect(
      service.reveal(
        'anon-1',
        { justification: 'Already revealed earlier.' },
        'registry-officer',
        fakeReq,
      ),
    ).rejects.toThrow(ValidationError);
    expect(mockedRepo.revealMarker).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the AnonymousMarking does not exist', async () => {
    mockedRepo.getById.mockResolvedValue(null);
    await expect(
      service.reveal(
        'missing',
        { justification: 'Required.' },
        'registry-officer',
        fakeReq,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('captures the revealing user via updatedBy + audit + event payload (no schema column)', async () => {
    await service.reveal(
      'anon-1',
      { justification: 'Audit trail check.' },
      'registry-officer',
      fakeReq,
    );
    expect(mockedRepo.revealMarker).toHaveBeenCalledWith('anon-1', 'registry-officer');
    const revealed = findEvent('anonymous_marking.revealed');
    expect(revealed?.data).toEqual(expect.objectContaining({ revealedBy: 'registry-officer' }));
  });

  it('audit subject is AnonymousMarking (the row is the system-of-record entity for disclosure)', async () => {
    await service.reveal(
      'anon-1',
      { justification: 'Audit subject check.' },
      'registry-officer',
      fakeReq,
    );
    expect(mockedLogAudit).toHaveBeenCalledWith(
      'AnonymousMarking',
      'anon-1',
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
    );
  });
});

describe('anonymousMarkingService.list / getById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('list forwards filters to the repository', async () => {
    mockedRepo.list.mockResolvedValue({
      data: [],
      pagination: { limit: 25, total: 0, hasNext: false, nextCursor: null },
    } as unknown as Awaited<ReturnType<typeof repo.list>>);
    await service.list({
      cursor: undefined,
      limit: 25,
      sort: 'createdAt',
      order: 'desc',
      assessmentId: 'assess-1',
      revealed: false,
    });
    expect(mockedRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({ assessmentId: 'assess-1', revealed: false }),
      expect.any(Object),
    );
  });

  it('getById throws NotFoundError when the AnonymousMarking is missing', async () => {
    mockedRepo.getById.mockResolvedValue(null);
    await expect(service.getById('missing')).rejects.toThrow(NotFoundError);
  });
});
