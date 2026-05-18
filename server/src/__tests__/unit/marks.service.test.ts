import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

// ── Mock dependencies before importing the service under test ──────────────
vi.mock('../../repositories/assessmentAttempt.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  findForAggregation: vi.fn(),
  countNonConfirmedByModuleRegistration: vi.fn(),
}));
vi.mock('../../repositories/moduleResult.repository', () => ({
  findByModuleRegistrationAndYear: vi.fn(),
}));
vi.mock('../../repositories/moduleRegistration.repository', () => ({
  getById: vi.fn(),
  findActiveForCohort: vi.fn(),
}));
vi.mock('../../api/module-results/module-results.service', () => ({
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));
vi.mock('../../repositories/assessment.repository', () => ({
  getById: vi.fn(),
}));
vi.mock('../../utils/grade-boundaries', () => ({ resolveGradeFromMark: vi.fn().mockResolvedValue(null) }));

import * as marksService from '../../api/marks/marks.service';
import * as repo from '../../repositories/assessmentAttempt.repository';
import * as assessmentRepo from '../../repositories/assessment.repository';
import * as moduleResultRepo from '../../repositories/moduleResult.repository';
import * as moduleRegistrationRepo from '../../repositories/moduleRegistration.repository';
import * as moduleResultsService from '../../api/module-results/module-results.service';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { resolveGradeFromMark } from '../../utils/grade-boundaries';

const mockedRepo = vi.mocked(repo);
const mockedAssessmentRepo = vi.mocked(assessmentRepo);
const mockedModuleResultRepo = vi.mocked(moduleResultRepo);
const mockedModuleRegistrationRepo = vi.mocked(moduleRegistrationRepo);
const mockedModuleResultsService = vi.mocked(moduleResultsService);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);
const mockedResolveGrade = vi.mocked(resolveGradeFromMark);

// ── Fixtures ───────────────────────────────────────────────────────────────
const fakeAttempt = {
  id: 'attempt-1',
  assessmentId: 'assess-1',
  moduleRegistrationId: 'modreg-1',
  attemptNumber: 1,
  status: 'PENDING',
  rawMark: null,
  moderatedMark: null,
  finalMark: null,
  grade: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  createdBy: null,
  updatedBy: null,
};

const fakeAssessment = {
  id: 'assess-1',
  moduleId: 'mod-1',
  academicYear: '2025/26',
  title: 'Coursework 1',
  assessmentType: 'COURSEWORK',
  weighting: 50,
  maxMark: { toNumber: () => 100 } as any, // Prisma Decimal
  passmark: { toNumber: () => 40 } as any,
  dueDate: new Date(),
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  createdBy: null,
  updatedBy: null,
} as any;

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

// ── Tests ──────────────────────────────────────────────────────────────────
describe('marks.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: assessment exists with maxMark 100
    mockedAssessmentRepo.getById.mockResolvedValue(fakeAssessment);
  });

  describe('list()', () => {
    it('should return paginated assessment attempt results', async () => {
      const paginatedResult = { data: [fakeAttempt], total: 1, nextCursor: null };
      mockedRepo.list.mockResolvedValue(paginatedResult);

      const result = await marksService.list({
        limit: 20,
        sort: 'createdAt',
        order: 'desc',
      });

      expect(mockedRepo.list).toHaveBeenCalledWith(
        { studentId: undefined, assessmentId: undefined, moduleRegistrationId: undefined, attemptNumber: undefined, status: undefined },
        { cursor: undefined, limit: 20, sort: 'createdAt', order: 'desc' },
      );
      expect(result).toEqual(paginatedResult);
    });

    it('should forward filter parameters to the repository', async () => {
      mockedRepo.list.mockResolvedValue({ data: [], total: 0, nextCursor: null });

      await marksService.list({
        limit: 10,
        sort: 'createdAt',
        order: 'asc',
        studentId: 'stu-1',
        assessmentId: 'assess-1',
        status: 'SUBMITTED',
      });

      expect(mockedRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: 'stu-1', assessmentId: 'assess-1', status: 'SUBMITTED' }),
        expect.any(Object),
      );
    });
  });

  describe('getById()', () => {
    it('should return the assessment attempt when found', async () => {
      mockedRepo.getById.mockResolvedValue(fakeAttempt as any);

      const result = await marksService.getById('attempt-1');
      expect(result).toEqual(fakeAttempt);
      expect(mockedRepo.getById).toHaveBeenCalledWith('attempt-1');
    });

    it('should throw NotFoundError when attempt does not exist', async () => {
      mockedRepo.getById.mockResolvedValue(null);

      await expect(marksService.getById('missing-id'))
        .rejects
        .toThrow(NotFoundError);
    });
  });

  describe('create()', () => {
    it('should create an assessment attempt, log audit, and emit event', async () => {
      const createData = {
        assessmentId: 'assess-1',
        moduleRegistrationId: 'modreg-1',
        attemptNumber: 1,
        status: 'PENDING' as const,
      };
      mockedRepo.create.mockResolvedValue({ ...fakeAttempt, ...createData } as any);

      const result = await marksService.create(createData as any, 'user-1', fakeReq);

      expect(mockedRepo.create).toHaveBeenCalledWith(createData);
      expect(mockedLogAudit).toHaveBeenCalledWith(
        'AssessmentAttempt',
        'attempt-1',
        'CREATE',
        'user-1',
        null,
        expect.objectContaining({ id: 'attempt-1' }),
        fakeReq,
      );
      expect(mockedEmitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'marks.created',
          entityType: 'AssessmentAttempt',
          entityId: 'attempt-1',
          actorId: 'user-1',
        }),
      );
      expect(result.id).toBe('attempt-1');
    });

    it('should emit marks.submitted when status is SUBMITTED', async () => {
      const createData = {
        assessmentId: 'assess-1',
        moduleRegistrationId: 'modreg-1',
        attemptNumber: 1,
        status: 'SUBMITTED' as const,
      };
      mockedRepo.create.mockResolvedValue({ ...fakeAttempt, status: 'SUBMITTED' } as any);

      await marksService.create(createData as any, 'user-1', fakeReq);

      expect(mockedEmitEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'marks.submitted' }),
      );
    });
  });

  describe('update()', () => {
    it('should update the attempt, log audit, and emit event on status change', async () => {
      const previous = { ...fakeAttempt, status: 'PENDING' };
      const updated = { ...fakeAttempt, status: 'SUBMITTED' };

      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      const result = await marksService.update('attempt-1', { status: 'SUBMITTED' } as any, 'user-1', fakeReq);

      expect(mockedLogAudit).toHaveBeenCalledWith(
        'AssessmentAttempt',
        'attempt-1',
        'UPDATE',
        'user-1',
        previous,
        updated,
        fakeReq,
      );
      expect(mockedEmitEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'marks.submitted' }),
      );
      expect(result.status).toBe('SUBMITTED');
    });

    it('should emit marks.released when finalMark and grade are set for the first time', async () => {
      const previous = { ...fakeAttempt, status: 'CONFIRMED', finalMark: null, grade: null };
      const updated = { ...fakeAttempt, status: 'CONFIRMED', finalMark: 72, grade: 'B' };

      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await marksService.update('attempt-1', { finalMark: 72, grade: 'B' } as any, 'user-1', fakeReq);

      // Should emit marks.released because finalMark/grade went from null to populated
      expect(mockedEmitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'marks.released',
          data: expect.objectContaining({ finalMark: 72, grade: 'B' }),
        }),
      );
    });

    it('should NOT emit marks.released if finalMark was already set', async () => {
      const previous = { ...fakeAttempt, status: 'CONFIRMED', finalMark: 60, grade: 'C' };
      const updated = { ...fakeAttempt, status: 'CONFIRMED', finalMark: 65, grade: 'C' };

      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await marksService.update('attempt-1', { finalMark: 65 } as any, 'user-1', fakeReq);

      const emittedEvents = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? c[0].event : c[0],
      );
      expect(emittedEvents).not.toContain('marks.released');
    });
  });

  describe('remove()', () => {
    it('should soft delete, log audit, and emit marks.deleted event', async () => {
      mockedRepo.getById.mockResolvedValue(fakeAttempt as any);
      mockedRepo.softDelete.mockResolvedValue(undefined as any);

      await marksService.remove('attempt-1', 'user-1', fakeReq);

      expect(mockedRepo.softDelete).toHaveBeenCalledWith('attempt-1');
      expect(mockedLogAudit).toHaveBeenCalledWith(
        'AssessmentAttempt',
        'attempt-1',
        'DELETE',
        'user-1',
        fakeAttempt,
        null,
        fakeReq,
      );
      expect(mockedEmitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'marks.deleted',
          entityType: 'AssessmentAttempt',
          entityId: 'attempt-1',
          data: expect.objectContaining({ status: 'DELETED' }),
        }),
      );
    });

    it('should throw NotFoundError if attempt does not exist before deletion', async () => {
      mockedRepo.getById.mockResolvedValue(null);

      await expect(marksService.remove('missing-id', 'user-1', fakeReq))
        .rejects
        .toThrow(NotFoundError);

      expect(mockedRepo.softDelete).not.toHaveBeenCalled();
    });
  });

  // ── maxMark validation ────────────────────────────────────────────────────
  describe('maxMark validation', () => {
    it('should reject create when rawMark exceeds assessment maxMark', async () => {
      mockedAssessmentRepo.getById.mockResolvedValue({ ...fakeAssessment, maxMark: 80 });

      await expect(
        marksService.create(
          { assessmentId: 'assess-1', moduleRegistrationId: 'modreg-1', attemptNumber: 1, rawMark: 85 } as any,
          'user-1',
          fakeReq,
        ),
      ).rejects.toThrow(/rawMark.*exceeds.*80/);

      expect(mockedRepo.create).not.toHaveBeenCalled();
    });

    it('should allow create when rawMark equals maxMark', async () => {
      mockedAssessmentRepo.getById.mockResolvedValue({ ...fakeAssessment, maxMark: 100 });
      mockedRepo.create.mockResolvedValue({ ...fakeAttempt, rawMark: 100, status: 'PENDING' } as any);

      const result = await marksService.create(
        { assessmentId: 'assess-1', moduleRegistrationId: 'modreg-1', attemptNumber: 1, rawMark: 100 } as any,
        'user-1',
        fakeReq,
      );

      expect(result.rawMark).toBe(100);
      expect(mockedRepo.create).toHaveBeenCalled();
    });

    it('should reject update when rawMark exceeds assessment maxMark', async () => {
      mockedAssessmentRepo.getById.mockResolvedValue({ ...fakeAssessment, maxMark: 75 });
      mockedRepo.getById.mockResolvedValue(fakeAttempt);

      await expect(
        marksService.update('attempt-1', { rawMark: 80 } as any, 'user-1', fakeReq),
      ).rejects.toThrow(/rawMark.*exceeds.*75/);

      expect(mockedRepo.update).not.toHaveBeenCalled();
    });

    it('should reject update when rawMark uses Prisma set wrapper and exceeds maxMark', async () => {
      mockedAssessmentRepo.getById.mockResolvedValue({ ...fakeAssessment, maxMark: 75 });
      mockedRepo.getById.mockResolvedValue(fakeAttempt);

      await expect(
        marksService.update('attempt-1', { rawMark: { set: 80 } } as any, 'user-1', fakeReq),
      ).rejects.toThrow(/rawMark.*exceeds.*75/);

      expect(mockedRepo.update).not.toHaveBeenCalled();
    });

    it('should reject create when finalMark exceeds assessment maxMark', async () => {
      mockedAssessmentRepo.getById.mockResolvedValue({ ...fakeAssessment, maxMark: 100 });

      await expect(
        marksService.create(
          { assessmentId: 'assess-1', moduleRegistrationId: 'modreg-1', attemptNumber: 1, finalMark: 110 } as any,
          'user-1',
          fakeReq,
        ),
      ).rejects.toThrow(/finalMark.*exceeds.*100/);
    });

    it('should skip validation when assessment has no maxMark', async () => {
      mockedAssessmentRepo.getById.mockResolvedValue({ ...fakeAssessment, maxMark: null });
      mockedRepo.create.mockResolvedValue({ ...fakeAttempt, rawMark: 999, status: 'PENDING' } as any);

      const result = await marksService.create(
        { assessmentId: 'assess-1', moduleRegistrationId: 'modreg-1', attemptNumber: 1, rawMark: 999 } as any,
        'user-1',
        fakeReq,
      );

      expect(result.rawMark).toBe(999);
    });
  });

  // ── Phase 17A — lifecycle state machine ──────────────────────────────────
  // Canonical AttemptStatus transition graph (mirrors marks.service.ts):
  //   PENDING   → SUBMITTED, DEFERRED
  //   SUBMITTED → MARKED, DEFERRED
  //   MARKED    → MODERATED, DEFERRED
  //   MODERATED → CONFIRMED, REFERRED, DEFERRED
  //   CONFIRMED → (terminal — no outgoing transitions; post-confirmation
  //                corrections must create a fresh AssessmentAttempt row)
  //   REFERRED  → SUBMITTED
  //   DEFERRED  → SUBMITTED
  describe('lifecycle state machine', () => {
    type Edge = { from: string; to: string };
    const validEdges: Edge[] = [
      { from: 'PENDING', to: 'SUBMITTED' },
      { from: 'PENDING', to: 'DEFERRED' },
      { from: 'SUBMITTED', to: 'MARKED' },
      { from: 'SUBMITTED', to: 'DEFERRED' },
      { from: 'MARKED', to: 'MODERATED' },
      { from: 'MARKED', to: 'DEFERRED' },
      { from: 'MODERATED', to: 'CONFIRMED' },
      { from: 'MODERATED', to: 'REFERRED' },
      { from: 'MODERATED', to: 'DEFERRED' },
      { from: 'REFERRED', to: 'SUBMITTED' },
      { from: 'DEFERRED', to: 'SUBMITTED' },
    ];

    for (const edge of validEdges) {
      it(`emits marks.status_changed on valid ${edge.from} → ${edge.to}`, async () => {
        // Phase 17B layered field-requirement guards on top of the bare
        // transition graph: MODERATED requires a moderatedMark, CONFIRMED
        // requires a finalMark / moderatedMark / rawMark to derive from.
        // Seed the previous row appropriately so the guard accepts the hop.
        const moderationFixture =
          edge.from === 'MARKED' || edge.from === 'MODERATED'
            ? { rawMark: 60, moderatedMark: 60, markedBy: 'marker-1' }
            : edge.from === 'PENDING' || edge.from === 'SUBMITTED'
              ? { markedBy: null }
              : {};
        const previous = { ...fakeAttempt, status: edge.from, ...moderationFixture };
        const updated = { ...fakeAttempt, status: edge.to, ...moderationFixture };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update('attempt-1', { status: edge.to } as any, 'user-1', fakeReq);

        const events = mockedEmitEvent.mock.calls.map((c) =>
          typeof c[0] === 'object' ? c[0] : null,
        );
        const statusChanged = events.find((e) => e && e.event === 'marks.status_changed');
        expect(statusChanged).toBeDefined();
        expect(statusChanged?.data).toEqual(
          expect.objectContaining({ previousStatus: edge.from, newStatus: edge.to }),
        );
      });
    }

    const invalidEdges: Edge[] = [
      { from: 'CONFIRMED', to: 'PENDING' },     // CONFIRMED is terminal
      { from: 'CONFIRMED', to: 'REFERRED' },    // CONFIRMED is terminal — fresh attempt row required
      { from: 'CONFIRMED', to: 'DEFERRED' },    // CONFIRMED is terminal
      { from: 'MARKED', to: 'CONFIRMED' },      // cannot skip moderation
      { from: 'DEFERRED', to: 'CONFIRMED' },    // deferred must re-enter via SUBMITTED
    ];

    for (const edge of invalidEdges) {
      it(`rejects invalid ${edge.from} → ${edge.to} transition with ValidationError`, async () => {
        const previous = { ...fakeAttempt, status: edge.from };
        mockedRepo.getById.mockResolvedValue(previous as any);

        await expect(
          marksService.update('attempt-1', { status: edge.to } as any, 'user-1', fakeReq),
        ).rejects.toThrow(ValidationError);

        expect(mockedRepo.update).not.toHaveBeenCalled();
      });
    }

    it('skips the guard when no status field is supplied (rawMark-only update)', async () => {
      const previous = { ...fakeAttempt, status: 'CONFIRMED' };
      const updated = { ...fakeAttempt, status: 'CONFIRMED', rawMark: 75 };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      // Without status, the guard must never fire even though previous status
      // is CONFIRMED (which has only one outgoing edge — REFERRED).
      await expect(
        marksService.update('attempt-1', { rawMark: 75 } as any, 'user-1', fakeReq),
      ).resolves.toBeDefined();

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? c[0].event : c[0],
      );
      expect(events).not.toContain('marks.status_changed');
    });

    it('skips the guard when status is supplied but unchanged', async () => {
      const previous = { ...fakeAttempt, status: 'MARKED' };
      const updated = { ...fakeAttempt, status: 'MARKED' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await expect(
        marksService.update('attempt-1', { status: 'MARKED' } as any, 'user-1', fakeReq),
      ).resolves.toBeDefined();

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? c[0].event : c[0],
      );
      expect(events).not.toContain('marks.status_changed');
    });

    it('rejects explicit CONFIRMED → CONFIRMED patch on an already-CONFIRMED row (terminal no-op)', async () => {
      const previous = { ...fakeAttempt, status: 'CONFIRMED', finalMark: 72, grade: 'B' };
      mockedRepo.getById.mockResolvedValue(previous as any);

      await expect(
        marksService.update('attempt-1', { status: 'CONFIRMED' } as any, 'user-1', fakeReq),
      ).rejects.toThrow(/Invalid attempt status transition/);

      expect(mockedRepo.update).not.toHaveBeenCalled();
    });

    it('emits both the specific event and marks.status_changed on a SUBMITTED → MARKED edge that has no specific mapping', async () => {
      // The pre-17A statusEventMap covers SUBMITTED, MODERATED, CONFIRMED.
      // MARKED has no specific event today, so the only emission should be
      // the new generic marks.status_changed.
      const previous = { ...fakeAttempt, status: 'SUBMITTED' };
      const updated = { ...fakeAttempt, status: 'MARKED' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await marksService.update('attempt-1', { status: 'MARKED' } as any, 'user-1', fakeReq);

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? c[0].event : c[0],
      );
      expect(events).toContain('marks.status_changed');
      // Existing surface preserved: there is no marks.marked event today,
      // and Phase 17A deliberately does not invent one.
      expect(events).not.toContain('marks.marked');
    });

    it('preserves existing marks.submitted emission alongside marks.status_changed', async () => {
      const previous = { ...fakeAttempt, status: 'PENDING' };
      const updated = { ...fakeAttempt, status: 'SUBMITTED' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await marksService.update('attempt-1', { status: 'SUBMITTED' } as any, 'user-1', fakeReq);

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? c[0].event : c[0],
      );
      expect(events).toContain('marks.submitted');
      expect(events).toContain('marks.status_changed');
    });
  });

  // ── Phase 17A — aggregateForModuleRegistration ────────────────────────────
  // Service-layer orchestration of marks aggregation. Pure-arithmetic cases
  // live in marks-aggregation.test.ts; this block exercises the I/O wiring,
  // grade resolution, persistence rules, audit, and event emission.
  describe('aggregateForModuleRegistration()', () => {
    const fakeModuleRegistration = {
      id: 'modreg-1',
      moduleId: 'mod-1',
      academicYear: '2025/26',
      enrolmentId: 'enrol-1',
    };

    beforeEach(() => {
      mockedModuleRegistrationRepo.getById.mockResolvedValue(fakeModuleRegistration as any);
      mockedRepo.findForAggregation.mockResolvedValue([]);
      mockedModuleResultRepo.findByModuleRegistrationAndYear.mockResolvedValue(null);
      mockedResolveGrade.mockResolvedValue(null);
    });

    it('throws NotFoundError when the moduleRegistration does not exist', async () => {
      mockedModuleRegistrationRepo.getById.mockResolvedValue(null);

      await expect(
        marksService.aggregateForModuleRegistration('missing', {}, 'user-1', fakeReq),
      ).rejects.toThrow(NotFoundError);
    });

    it('returns a preview outcome and emits marks.aggregated without persisting', async () => {
      mockedRepo.findForAggregation.mockResolvedValue([
        { id: 'a-1', assessmentId: 'assess-1', finalMark: 60, maxMark: 100, weighting: 50, status: 'CONFIRMED' },
        { id: 'a-2', assessmentId: 'assess-2', finalMark: 80, maxMark: 100, weighting: 50, status: 'CONFIRMED' },
      ]);

      const result = await marksService.aggregateForModuleRegistration(
        'modreg-1',
        {},
        'user-1',
        fakeReq,
      );

      expect(result.aggregatePercentage).toBe(70);
      expect(result.totalWeighting).toBe(100);
      expect(result.isComplete).toBe(true);
      expect(result.persisted).toBe(false);
      expect(result.moduleResultId).toBeNull();

      expect(mockedModuleResultsService.create).not.toHaveBeenCalled();
      expect(mockedModuleResultsService.update).not.toHaveBeenCalled();

      const aggregatedEvent = mockedEmitEvent.mock.calls
        .map((c) => (typeof c[0] === 'object' ? c[0] : null))
        .find((e) => e && e.event === 'marks.aggregated');
      expect(aggregatedEvent).toBeDefined();
      expect(aggregatedEvent?.data).toEqual(
        expect.objectContaining({
          aggregatePercentage: 70,
          isComplete: true,
          persisted: false,
          moduleResultId: null,
          attemptStatuses: ['CONFIRMED'],
        }),
      );

      expect(mockedLogAudit).toHaveBeenCalledWith(
        'ModuleRegistration',
        'modreg-1',
        'UPDATE',
        'user-1',
        null,
        expect.objectContaining({ aggregatePercentage: 70 }),
        fakeReq,
      );
    });

    it('passes a custom attemptStatuses filter through to the repo helper', async () => {
      mockedRepo.findForAggregation.mockResolvedValue([
        { id: 'a-1', assessmentId: 'assess-1', finalMark: 50, maxMark: 100, weighting: 100, status: 'MODERATED' },
      ]);

      await marksService.aggregateForModuleRegistration(
        'modreg-1',
        { attemptStatuses: ['MARKED', 'MODERATED'] },
        'user-1',
        fakeReq,
      );

      expect(mockedRepo.findForAggregation).toHaveBeenCalledWith('modreg-1', {
        statuses: ['MARKED', 'MODERATED'],
      });
    });

    it('resolves a grade from the supplied boundaryAssessmentId', async () => {
      mockedRepo.findForAggregation.mockResolvedValue([
        { id: 'a-1', assessmentId: 'assess-1', finalMark: 72, maxMark: 100, weighting: 100, status: 'CONFIRMED' },
      ]);
      mockedResolveGrade.mockResolvedValue('B');

      const result = await marksService.aggregateForModuleRegistration(
        'modreg-1',
        { boundaryAssessmentId: 'assess-boundary' },
        'user-1',
        fakeReq,
      );

      expect(mockedResolveGrade).toHaveBeenCalledWith('assess-boundary', 72);
      expect(result.grade).toBe('B');
    });

    it('does NOT call resolveGradeFromMark when boundaryAssessmentId is omitted', async () => {
      mockedRepo.findForAggregation.mockResolvedValue([
        { id: 'a-1', assessmentId: 'assess-1', finalMark: 72, maxMark: 100, weighting: 100, status: 'CONFIRMED' },
      ]);

      const result = await marksService.aggregateForModuleRegistration(
        'modreg-1',
        {},
        'user-1',
        fakeReq,
      );

      expect(mockedResolveGrade).not.toHaveBeenCalled();
      expect(result.grade).toBeNull();
    });

    it('persist:true creates a new ModuleResult when none exists for the year', async () => {
      mockedRepo.findForAggregation.mockResolvedValue([
        { id: 'a-1', assessmentId: 'assess-1', finalMark: 100, maxMark: 100, weighting: 100, status: 'CONFIRMED' },
      ]);
      mockedModuleResultsService.create.mockResolvedValue({ id: 'mr-new', status: 'PROVISIONAL' } as any);

      const result = await marksService.aggregateForModuleRegistration(
        'modreg-1',
        { persist: true },
        'user-1',
        fakeReq,
      );

      expect(mockedModuleResultsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          moduleRegistrationId: 'modreg-1',
          moduleId: 'mod-1',
          academicYear: '2025/26',
          aggregateMark: 100,
          status: 'PROVISIONAL',
        }),
        'user-1',
        fakeReq,
      );
      expect(result.persisted).toBe(true);
      expect(result.moduleResultId).toBe('mr-new');
    });

    it('persist:true updates an existing PROVISIONAL ModuleResult instead of duplicating', async () => {
      mockedRepo.findForAggregation.mockResolvedValue([
        { id: 'a-1', assessmentId: 'assess-1', finalMark: 50, maxMark: 100, weighting: 100, status: 'CONFIRMED' },
      ]);
      mockedModuleResultRepo.findByModuleRegistrationAndYear.mockResolvedValue({
        id: 'mr-existing',
        status: 'PROVISIONAL',
      } as any);
      mockedModuleResultsService.update.mockResolvedValue({ id: 'mr-existing', status: 'PROVISIONAL' } as any);

      const result = await marksService.aggregateForModuleRegistration(
        'modreg-1',
        { persist: true },
        'user-1',
        fakeReq,
      );

      expect(mockedModuleResultsService.update).toHaveBeenCalledWith(
        'mr-existing',
        expect.objectContaining({ aggregateMark: 50 }),
        'user-1',
        fakeReq,
      );
      expect(mockedModuleResultsService.create).not.toHaveBeenCalled();
      expect(result.persisted).toBe(true);
      expect(result.moduleResultId).toBe('mr-existing');
    });

    it('persist:true refuses to overwrite a CONFIRMED ModuleResult', async () => {
      mockedRepo.findForAggregation.mockResolvedValue([
        { id: 'a-1', assessmentId: 'assess-1', finalMark: 100, maxMark: 100, weighting: 100, status: 'CONFIRMED' },
      ]);
      mockedModuleResultRepo.findByModuleRegistrationAndYear.mockResolvedValue({
        id: 'mr-confirmed',
        status: 'CONFIRMED',
      } as any);

      await expect(
        marksService.aggregateForModuleRegistration('modreg-1', { persist: true }, 'user-1', fakeReq),
      ).rejects.toThrow(/CONFIRMED ModuleResult/);

      expect(mockedModuleResultsService.update).not.toHaveBeenCalled();
      expect(mockedModuleResultsService.create).not.toHaveBeenCalled();
    });

    it('persist:true rejects an incomplete aggregation without force', async () => {
      mockedRepo.findForAggregation.mockResolvedValue([
        { id: 'a-1', assessmentId: 'present', finalMark: 60, maxMark: 100, weighting: 50, status: 'CONFIRMED' },
        { id: 'a-2', assessmentId: 'missing', finalMark: null, maxMark: 100, weighting: 50, status: 'CONFIRMED' },
      ]);

      await expect(
        marksService.aggregateForModuleRegistration('modreg-1', { persist: true }, 'user-1', fakeReq),
      ).rejects.toThrow(ValidationError);

      expect(mockedModuleResultsService.create).not.toHaveBeenCalled();
    });

    it('persist:true rejects incomplete aggregation when a row contributes zero weight without blaming missing marks', async () => {
      mockedRepo.findForAggregation.mockResolvedValue([
        { id: 'a-1', assessmentId: 'assess-1', finalMark: 60, maxMark: 100, weighting: 100, status: 'CONFIRMED' },
        { id: 'a-2', assessmentId: 'assess-2', finalMark: 80, maxMark: 100, weighting: 0, status: 'CONFIRMED' },
      ]);

      await expect(
        marksService.aggregateForModuleRegistration('modreg-1', { persist: true }, 'user-1', fakeReq),
      ).rejects.toThrow(/did not contribute/);

      expect(mockedModuleResultsService.create).not.toHaveBeenCalled();
    });

    it('persist:true with force=true accepts an incomplete aggregation and records force in the event', async () => {
      mockedRepo.findForAggregation.mockResolvedValue([
        { id: 'a-1', assessmentId: 'present', finalMark: 60, maxMark: 100, weighting: 50, status: 'CONFIRMED' },
        { id: 'a-2', assessmentId: 'missing', finalMark: null, maxMark: 100, weighting: 50, status: 'CONFIRMED' },
      ]);
      mockedModuleResultsService.create.mockResolvedValue({ id: 'mr-forced', status: 'PROVISIONAL' } as any);

      const result = await marksService.aggregateForModuleRegistration(
        'modreg-1',
        { persist: true, force: true },
        'user-1',
        fakeReq,
      );

      expect(result.persisted).toBe(true);
      expect(result.isComplete).toBe(false);
      const aggregatedEvent = mockedEmitEvent.mock.calls
        .map((c) => (typeof c[0] === 'object' ? c[0] : null))
        .find((e) => e && e.event === 'marks.aggregated');
      expect(aggregatedEvent?.data).toEqual(
        expect.objectContaining({ force: true, isComplete: false, persisted: true }),
      );
    });

    it('persist:true rejects when no contributing attempts are found', async () => {
      mockedRepo.findForAggregation.mockResolvedValue([]);

      await expect(
        marksService.aggregateForModuleRegistration('modreg-1', { persist: true }, 'user-1', fakeReq),
      ).rejects.toThrow(/no contributing AssessmentAttempt/);
    });

    it('persist:true rejects when the contributing weightings do not sum to 100', async () => {
      mockedRepo.findForAggregation.mockResolvedValue([
        { id: 'a-1', assessmentId: 'a-1', finalMark: 60, maxMark: 100, weighting: 30, status: 'CONFIRMED' },
        { id: 'a-2', assessmentId: 'a-2', finalMark: 80, maxMark: 100, weighting: 30, status: 'CONFIRMED' },
      ]);

      await expect(
        marksService.aggregateForModuleRegistration('modreg-1', { persist: true }, 'user-1', fakeReq),
      ).rejects.toThrow(/total contributing weighting is 60/);
    });

    it('preview path emits marks.aggregated even when there are zero attempts', async () => {
      // No attempts found — preview returns null aggregate but still emits
      // the event so that operators can audit the empty cohort outcome.
      mockedRepo.findForAggregation.mockResolvedValue([]);

      const result = await marksService.aggregateForModuleRegistration(
        'modreg-1',
        {},
        'user-1',
        fakeReq,
      );

      expect(result.aggregatePercentage).toBeNull();
      expect(result.contributingCount).toBe(0);
      expect(result.persisted).toBe(false);

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? c[0].event : c[0],
      );
      expect(events).toContain('marks.aggregated');
    });
  });

  // ── Phase 17B — moderation business rules + action endpoints ─────────────
  // Layered on top of the 17A transition graph. The graph already says
  // "you may move MARKED → MODERATED"; this layer adds the substantive
  // rules every UK HE quality framework expects on top of the graph.
  describe('moderation business rules', () => {
    describe('MARKED → MODERATED', () => {
      it('rejects MARKED → MODERATED when no moderatedMark is supplied or already on the row', async () => {
        const previous = { ...fakeAttempt, status: 'MARKED', moderatedMark: null, rawMark: 60, markedBy: 'marker-1' };
        mockedRepo.getById.mockResolvedValue(previous as any);

        await expect(
          marksService.update('attempt-1', { status: 'MODERATED' } as any, 'user-2', fakeReq),
        ).rejects.toThrow(/without a moderatedMark/);
        expect(mockedRepo.update).not.toHaveBeenCalled();
      });

      it('accepts MARKED → MODERATED when moderatedMark is supplied in the same patch', async () => {
        const previous = { ...fakeAttempt, status: 'MARKED', moderatedMark: null, rawMark: 60, markedBy: 'marker-1' };
        const updated = { ...fakeAttempt, status: 'MODERATED', moderatedMark: 65, rawMark: 60, markedBy: 'marker-1', moderatedBy: 'user-2' };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update(
          'attempt-1',
          { status: 'MODERATED', moderatedMark: 65 } as any,
          'user-2',
          fakeReq,
        );

        expect(mockedRepo.update).toHaveBeenCalledWith(
          'attempt-1',
          expect.objectContaining({ status: 'MODERATED', moderatedMark: 65 }),
        );
      });

      it('accepts MARKED → MODERATED when moderatedMark is already on the row', async () => {
        const previous = { ...fakeAttempt, status: 'MARKED', moderatedMark: 70, rawMark: 60, markedBy: 'marker-1' };
        const updated = { ...fakeAttempt, status: 'MODERATED', moderatedMark: 70, rawMark: 60, markedBy: 'marker-1', moderatedBy: 'user-2' };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update(
          'attempt-1',
          { status: 'MODERATED' } as any,
          'user-2',
          fakeReq,
        );

        expect(mockedRepo.update).toHaveBeenCalled();
      });

      it('auto-stamps moderatedDate and moderatedBy when not supplied', async () => {
        const previous = { ...fakeAttempt, status: 'MARKED', moderatedMark: null, rawMark: 60, markedBy: 'marker-1' };
        const updated = { ...fakeAttempt, status: 'MODERATED', moderatedMark: 65 };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update(
          'attempt-1',
          { status: 'MODERATED', moderatedMark: 65 } as any,
          'user-2',
          fakeReq,
        );

        const call = mockedRepo.update.mock.calls[0]?.[1] as any;
        expect(call?.moderatedBy).toBe('user-2');
        expect(call?.moderatedDate).toBeInstanceOf(Date);
      });

      it('respects an explicit moderatedBy in the patch over the authenticated user', async () => {
        // An explicit moderatedBy in the patch is honoured. The independence
        // guard runs against the post-patch effective moderator, not the
        // authenticated user — so attributing the action to a colleague is
        // allowed, provided the named moderator is independent of the marker.
        const previous = { ...fakeAttempt, status: 'MARKED', moderatedMark: null, rawMark: 60, markedBy: 'marker-1' };
        const updated = { ...fakeAttempt, status: 'MODERATED', moderatedMark: 65 };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update(
          'attempt-1',
          { status: 'MODERATED', moderatedMark: 65, moderatedBy: 'explicit-mod' } as any,
          'user-2',
          fakeReq,
        );

        const call = mockedRepo.update.mock.calls[0]?.[1] as any;
        expect(call?.moderatedBy).toBe('explicit-mod');
      });

      it('accepts an explicit moderatedBy when it matches the authenticated user', async () => {
        const previous = { ...fakeAttempt, status: 'MARKED', moderatedMark: null, rawMark: 60, markedBy: 'marker-1' };
        const updated = { ...fakeAttempt, status: 'MODERATED', moderatedMark: 65 };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update(
          'attempt-1',
          { status: 'MODERATED', moderatedMark: 65, moderatedBy: 'user-2' } as any,
          'user-2',
          fakeReq,
        );

        const call = mockedRepo.update.mock.calls[0]?.[1] as any;
        expect(call?.moderatedBy).toBe('user-2');
      });
    });

    describe('moderator independence', () => {
      it('rejects MARKED → MODERATED when the authenticated moderator equals the existing markedBy', async () => {
        const previous = { ...fakeAttempt, status: 'MARKED', moderatedMark: null, rawMark: 60, markedBy: 'marker-1' };
        mockedRepo.getById.mockResolvedValue(previous as any);

        await expect(
          marksService.update(
            'attempt-1',
            { status: 'MODERATED', moderatedMark: 65 } as any,
            'marker-1',
            fakeReq,
          ),
        ).rejects.toThrow(/Moderator must be independent/);
        expect(mockedRepo.update).not.toHaveBeenCalled();
      });

      it('rejects MARKED → MODERATED when the authenticated user equals markedBy even with an explicit moderatedBy', async () => {
        // Explicit moderatedBy is honoured for attribution; independence is
        // evaluated against that effective moderator. Supplying moderatedBy
        // equal to markedBy therefore still fails the independence guard.
        const previous = { ...fakeAttempt, status: 'MARKED', moderatedMark: null, rawMark: 60, markedBy: 'marker-1' };
        mockedRepo.getById.mockResolvedValue(previous as any);

        await expect(
          marksService.update(
            'attempt-1',
            { status: 'MODERATED', moderatedMark: 65, moderatedBy: 'marker-1' } as any,
            'marker-1',
            fakeReq,
          ),
        ).rejects.toThrow(/Moderator must be independent/);
      });

      it('rejects a moderatedBy-only patch that points to the existing markedBy', async () => {
        const previous = { ...fakeAttempt, status: 'MODERATED', moderatedMark: 65, markedBy: 'marker-1', moderatedBy: 'mod-old' };
        mockedRepo.getById.mockResolvedValue(previous as any);

        await expect(
          marksService.update(
            'attempt-1',
            { moderatedBy: 'marker-1' } as any,
            'user-3',
            fakeReq,
          ),
        ).rejects.toThrow(/Moderator must be independent/);
      });

      it('treats an explicit markedBy null in the patch as the effective marker (no fallback to previous markedBy)', async () => {
        // When the patch explicitly clears markedBy (e.g. operational
        // backfill), the independence check should compare against the
        // post-patch effective markedBy (null) — not the pre-patch
        // value. Independence trivially holds against null.
        // The authenticated moderator is 'marker-1'; explicit moderatedBy
        // would have to match — but to also exercise the auto-stamp path
        // we omit moderatedBy and let the service fill it in from userId.
        const previous = { ...fakeAttempt, status: 'MARKED', moderatedMark: null, rawMark: 60, markedBy: 'marker-1' };
        const updated = {
          ...fakeAttempt,
          status: 'MODERATED',
          moderatedMark: 65,
          markedBy: null,
          moderatedBy: 'marker-1',
        };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update(
          'attempt-1',
          { status: 'MODERATED', moderatedMark: 65, markedBy: null } as any,
          'marker-1',
          fakeReq,
        );

        expect(mockedRepo.update).toHaveBeenCalled();
      });

      it('does not raise the independence guard when markedBy is null', async () => {
        // Pre-MARKED transitions have no marker recorded. The guard is a
        // no-op in that case rather than rejecting every PENDING/SUBMITTED
        // mutation.
        const previous = { ...fakeAttempt, status: 'PENDING', markedBy: null };
        const updated = { ...fakeAttempt, status: 'SUBMITTED', markedBy: null };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await expect(
          marksService.update('attempt-1', { status: 'SUBMITTED' } as any, 'user-1', fakeReq),
        ).resolves.toBeDefined();
      });
    });

    describe('MODERATED → CONFIRMED', () => {
      it('auto-derives finalMark from moderatedMark when not supplied', async () => {
        const previous = { ...fakeAttempt, status: 'MODERATED', moderatedMark: 72, rawMark: 60, markedBy: 'marker-1', moderatedBy: 'mod-1', finalMark: null };
        const updated = { ...fakeAttempt, status: 'CONFIRMED', moderatedMark: 72, finalMark: 72 };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update('attempt-1', { status: 'CONFIRMED' } as any, 'user-3', fakeReq);

        const call = mockedRepo.update.mock.calls[0]?.[1] as any;
        expect(call?.finalMark).toBe(72);
      });

      it('falls back to rawMark when moderatedMark is absent (non-moderated path)', async () => {
        const previous = { ...fakeAttempt, status: 'MODERATED', moderatedMark: null, rawMark: 55, markedBy: 'marker-1', finalMark: null };
        const updated = { ...fakeAttempt, status: 'CONFIRMED', finalMark: 55 };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update('attempt-1', { status: 'CONFIRMED' } as any, 'user-3', fakeReq);

        const call = mockedRepo.update.mock.calls[0]?.[1] as any;
        expect(call?.finalMark).toBe(55);
      });

      it('rejects CONFIRMED transition when no source mark is available', async () => {
        const previous = { ...fakeAttempt, status: 'MODERATED', moderatedMark: null, rawMark: null, markedBy: 'marker-1', finalMark: null };
        mockedRepo.getById.mockResolvedValue(previous as any);

        await expect(
          marksService.update('attempt-1', { status: 'CONFIRMED' } as any, 'user-3', fakeReq),
        ).rejects.toThrow(/Cannot transition AssessmentAttempt to CONFIRMED without/);
        expect(mockedRepo.update).not.toHaveBeenCalled();
      });

      it('respects an explicit finalMark over auto-derivation', async () => {
        const previous = { ...fakeAttempt, status: 'MODERATED', moderatedMark: 72, rawMark: 60, markedBy: 'marker-1', finalMark: null };
        const updated = { ...fakeAttempt, status: 'CONFIRMED', finalMark: 75 };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update('attempt-1', { status: 'CONFIRMED', finalMark: 75 } as any, 'user-3', fakeReq);

        const call = mockedRepo.update.mock.calls[0]?.[1] as any;
        expect(call?.finalMark).toBe(75);
      });
      it('derives finalMark from incoming moderatedMark when previous row has no moderatedMark (combined patch)', async () => {
        // Caller sends moderatedMark + status: CONFIRMED in one request while
        // previous row has moderatedMark: null. The resolver must use the
        // incoming moderatedMark rather than the stale persisted null.
        const previous = { ...fakeAttempt, status: 'MODERATED', moderatedMark: null, rawMark: 60, markedBy: 'marker-1', moderatedBy: 'mod-1', finalMark: null };
        const updated = { ...fakeAttempt, status: 'CONFIRMED', moderatedMark: 78, finalMark: 78 };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update(
          'attempt-1',
          { status: 'CONFIRMED', moderatedMark: 78 } as any,
          'user-3',
          fakeReq,
        );

        const call = mockedRepo.update.mock.calls[0]?.[1] as any;
        expect(call?.finalMark).toBe(78);
      });

      it('derives finalMark from incoming rawMark when previous row has neither moderatedMark nor rawMark (combined patch)', async () => {
        // Non-moderated path: caller sends rawMark + status: CONFIRMED.
        // Previous row has no source mark at all; incoming rawMark must be
        // used as the last-resort fallback.
        const previous = { ...fakeAttempt, status: 'MODERATED', moderatedMark: null, rawMark: null, markedBy: 'marker-1', moderatedBy: 'mod-1', finalMark: null };
        const updated = { ...fakeAttempt, status: 'CONFIRMED', rawMark: 45, finalMark: 45 };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update(
          'attempt-1',
          { status: 'CONFIRMED', rawMark: 45 } as any,
          'user-3',
          fakeReq,
        );

        const call = mockedRepo.update.mock.calls[0]?.[1] as any;
        expect(call?.finalMark).toBe(45);
      });

      it('handles a {set: Decimal} wrapped moderatedMark when deriving finalMark on CONFIRMED', async () => {
        // Prisma wraps Decimal fields in {set: Decimal} form when building
        // update payloads. extractIncomingNumber must unwrap this so the
        // resolver can use the value as a finalMark source.
        const fakeDecimal = { toNumber: () => 83 };
        const previous = { ...fakeAttempt, status: 'MODERATED', moderatedMark: null, rawMark: 60, markedBy: 'marker-1', moderatedBy: 'mod-1', finalMark: null };
        const updated = { ...fakeAttempt, status: 'CONFIRMED', moderatedMark: 83, finalMark: 83 };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update(
          'attempt-1',
          { status: 'CONFIRMED', moderatedMark: { set: fakeDecimal } } as any,
          'user-3',
          fakeReq,
        );

        const call = mockedRepo.update.mock.calls[0]?.[1] as any;
        expect(call?.finalMark).toBe(83);
      });
    });

    describe('MARKED transition stamping', () => {
      it('auto-stamps markedDate and markedBy on the SUBMITTED → MARKED edge', async () => {
        const previous = { ...fakeAttempt, status: 'SUBMITTED', markedBy: null };
        const updated = { ...fakeAttempt, status: 'MARKED', markedBy: 'user-1' };
        mockedRepo.getById.mockResolvedValue(previous as any);
        mockedRepo.update.mockResolvedValue(updated as any);

        await marksService.update('attempt-1', { status: 'MARKED', rawMark: 60 } as any, 'user-1', fakeReq);

        const call = mockedRepo.update.mock.calls[0]?.[1] as any;
        expect(call?.markedBy).toBe('user-1');
        expect(call?.markedDate).toBeInstanceOf(Date);
      });
    });
  });

  describe('moderateAttempt() action endpoint', () => {
    it('drives MARKED → MODERATED through update() and stamps audit fields', async () => {
      const previous = { ...fakeAttempt, status: 'MARKED', rawMark: 60, markedBy: 'marker-1' };
      const updated = { ...fakeAttempt, status: 'MODERATED', moderatedMark: 65, moderatedBy: 'mod-1' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      const result = await marksService.moderateAttempt(
        'attempt-1',
        { moderatedMark: 65, feedback: 'Coherent argument' },
        'mod-1',
        fakeReq,
      );

      expect(mockedRepo.update).toHaveBeenCalledWith(
        'attempt-1',
        expect.objectContaining({
          status: 'MODERATED',
          moderatedMark: 65,
          feedback: 'Coherent argument',
          moderatedDate: expect.any(Date),
          moderatedBy: 'mod-1',
        }),
      );
      expect(result.status).toBe('MODERATED');
    });

    it('rejects when current status is not MARKED', async () => {
      const previous = { ...fakeAttempt, status: 'SUBMITTED', rawMark: 60, markedBy: null };
      mockedRepo.getById.mockResolvedValue(previous as any);

      await expect(
        marksService.moderateAttempt('attempt-1', { moderatedMark: 65 }, 'mod-1', fakeReq),
      ).rejects.toThrow(/Invalid attempt status transition/);
    });

    it('rejects when the moderator is the same as the marker', async () => {
      const previous = { ...fakeAttempt, status: 'MARKED', rawMark: 60, markedBy: 'shared-user' };
      mockedRepo.getById.mockResolvedValue(previous as any);

      await expect(
        marksService.moderateAttempt('attempt-1', { moderatedMark: 65 }, 'shared-user', fakeReq),
      ).rejects.toThrow(/Moderator must be independent/);
    });
  });

  describe('ratifyAttempt() action endpoint', () => {
    it('drives MODERATED → CONFIRMED, auto-deriving finalMark from moderatedMark', async () => {
      const previous = { ...fakeAttempt, status: 'MODERATED', moderatedMark: 72, rawMark: 60, markedBy: 'marker-1', moderatedBy: 'mod-1', finalMark: null };
      const updated = { ...fakeAttempt, status: 'CONFIRMED', finalMark: 72, grade: 'B' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);
      mockedResolveGrade.mockResolvedValue('B');

      const result = await marksService.ratifyAttempt('attempt-1', {}, 'board-chair', fakeReq);

      const call = mockedRepo.update.mock.calls[0]?.[1] as any;
      expect(call?.status).toBe('CONFIRMED');
      expect(call?.finalMark).toBe(72);
      expect(result.status).toBe('CONFIRMED');
    });

    it('respects an explicit finalMark/grade in the body', async () => {
      const previous = { ...fakeAttempt, status: 'MODERATED', moderatedMark: 72, rawMark: 60, markedBy: 'marker-1', moderatedBy: 'mod-1', finalMark: null };
      const updated = { ...fakeAttempt, status: 'CONFIRMED', finalMark: 75, grade: 'A' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await marksService.ratifyAttempt('attempt-1', { finalMark: 75, grade: 'A' }, 'board-chair', fakeReq);

      const call = mockedRepo.update.mock.calls[0]?.[1] as any;
      expect(call?.finalMark).toBe(75);
      expect(call?.grade).toBe('A');
    });

    it('emits both marks.ratified and marks.released on the transition', async () => {
      const previous = { ...fakeAttempt, status: 'MODERATED', moderatedMark: 72, rawMark: 60, markedBy: 'marker-1', moderatedBy: 'mod-1', finalMark: null, grade: null };
      const updated = { ...fakeAttempt, status: 'CONFIRMED', finalMark: 72, grade: 'B' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await marksService.ratifyAttempt('attempt-1', {}, 'board-chair', fakeReq);

      const events = mockedEmitEvent.mock.calls.map((c) => (typeof c[0] === 'object' ? c[0].event : c[0]));
      expect(events).toContain('marks.ratified');
      expect(events).toContain('marks.released');
      expect(events).toContain('marks.status_changed');
    });

    it('rejects re-ratifying a CONFIRMED row (terminal-state protection)', async () => {
      const previous = { ...fakeAttempt, status: 'CONFIRMED', finalMark: 72, grade: 'B' };
      mockedRepo.getById.mockResolvedValue(previous as any);

      await expect(
        marksService.ratifyAttempt('attempt-1', {}, 'board-chair', fakeReq),
      ).rejects.toThrow(/Invalid attempt status transition/);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    });
  });

  // ── Phase 17C — cohort-level module result generation ─────────────────────
  // generateModuleResultsForCohort batches the 17A primitive across an entire
  // (moduleId, academicYear) cohort. The tests exercise the batch-only
  // semantics (per-row idempotency, error isolation, summary accounting,
  // event emission); the per-row aggregation maths is covered by the
  // aggregateForModuleRegistration block above.
  describe('generateModuleResultsForCohort()', () => {
    const fakeModuleRegistration = {
      id: 'modreg-1',
      moduleId: 'mod-1',
      academicYear: '2025/26',
      enrolmentId: 'enrol-1',
    };

    /**
     * Helper — primes the per-row aggregation path so the cohort generator
     * can call `aggregateForModuleRegistration` for the supplied
     * registrations without each invocation needing its own setup. The
     * aggregator under the covers calls `moduleRegistrationRepo.getById`
     * (returning the row) and `repo.findForAggregation` (returning empty
     * by default — see `attempts` opt-in for non-empty cohorts).
     */
    function primeAggregationPath(opts: { attempts?: unknown[] } = {}): void {
      mockedModuleRegistrationRepo.getById.mockResolvedValue(fakeModuleRegistration as any);
      mockedRepo.findForAggregation.mockResolvedValue((opts.attempts ?? []) as any);
    }

    beforeEach(() => {
      mockedModuleRegistrationRepo.findActiveForCohort.mockResolvedValue([]);
      mockedModuleResultRepo.findByModuleRegistrationAndYear.mockResolvedValue(null);
      primeAggregationPath();
    });

    it('returns total: 0 with an empty cohort and emits the batch event', async () => {
      mockedModuleRegistrationRepo.findActiveForCohort.mockResolvedValue([]);

      const result = await marksService.generateModuleResultsForCohort(
        'mod-1',
        '2025/26',
        {},
        'user-1',
        fakeReq,
      );

      expect(result).toEqual(
        expect.objectContaining({
          moduleId: 'mod-1',
          academicYear: '2025/26',
          total: 0,
          persisted: 0,
          previewed: 0,
          skipped: 0,
          failed: 0,
          results: [],
        }),
      );

      const events = mockedEmitEvent.mock.calls.map((c) => (typeof c[0] === 'object' ? c[0] : null));
      const batchEvent = events.find((e) => e && e.event === 'module_results.batch_generated');
      expect(batchEvent).toBeDefined();
      expect(batchEvent?.data).toEqual(
        expect.objectContaining({ moduleId: 'mod-1', academicYear: '2025/26', total: 0 }),
      );
    });

    it('runs preview-mode aggregation per row and reports them as previewed', async () => {
      mockedModuleRegistrationRepo.findActiveForCohort.mockResolvedValue([
        { id: 'mr-1', enrolmentId: 'e-1', status: 'REGISTERED' },
        { id: 'mr-2', enrolmentId: 'e-2', status: 'REGISTERED' },
      ] as any);
      // Aggregator path: each call resolves the module registration and an empty
      // attempt set (preview returns null aggregate but still succeeds).
      mockedModuleRegistrationRepo.getById.mockImplementation(async (id: string) => ({
        id,
        moduleId: 'mod-1',
        academicYear: '2025/26',
        enrolmentId: id === 'mr-1' ? 'e-1' : 'e-2',
      }) as any);
      mockedRepo.findForAggregation.mockResolvedValue([]);

      const result = await marksService.generateModuleResultsForCohort(
        'mod-1',
        '2025/26',
        {},
        'user-1',
        fakeReq,
      );

      expect(result.total).toBe(2);
      expect(result.previewed).toBe(2);
      expect(result.persisted).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results.map((r) => r.moduleRegistrationId)).toEqual(['mr-1', 'mr-2']);
      expect(result.results.every((r) => r.outcome === 'previewed')).toBe(true);
    });

    it('skips rows whose existing ModuleResult is already CONFIRMED', async () => {
      mockedModuleRegistrationRepo.findActiveForCohort.mockResolvedValue([
        { id: 'mr-confirmed', enrolmentId: 'e-1', status: 'COMPLETED' },
      ] as any);
      mockedModuleResultRepo.findByModuleRegistrationAndYear.mockResolvedValue({
        id: 'mr-existing',
        status: 'CONFIRMED',
      } as any);

      const result = await marksService.generateModuleResultsForCohort(
        'mod-1',
        '2025/26',
        { persist: true },
        'user-1',
        fakeReq,
      );

      expect(result.total).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.persisted).toBe(0);
      expect(result.results[0]).toEqual(
        expect.objectContaining({
          moduleRegistrationId: 'mr-confirmed',
          outcome: 'skipped',
          aggregation: null,
          reason: expect.stringMatching(/already CONFIRMED/),
        }),
      );
      // The aggregator must not have run for the skipped row.
      expect(mockedRepo.findForAggregation).not.toHaveBeenCalled();
    });

    it('isolates per-row failures so one bad row does not abort the cohort', async () => {
      mockedModuleRegistrationRepo.findActiveForCohort.mockResolvedValue([
        { id: 'mr-good', enrolmentId: 'e-1', status: 'REGISTERED' },
        { id: 'mr-bad', enrolmentId: 'e-2', status: 'REGISTERED' },
        { id: 'mr-good-2', enrolmentId: 'e-3', status: 'REGISTERED' },
      ] as any);
      // Aggregator throws on the second row only — first and third proceed.
      mockedModuleRegistrationRepo.getById.mockImplementation(async (id: string) => {
        if (id === 'mr-bad') return null; // forces NotFoundError inside aggregateForModuleRegistration
        return {
          id,
          moduleId: 'mod-1',
          academicYear: '2025/26',
          enrolmentId: 'e-x',
        } as any;
      });

      const result = await marksService.generateModuleResultsForCohort(
        'mod-1',
        '2025/26',
        {},
        'user-1',
        fakeReq,
      );

      expect(result.total).toBe(3);
      expect(result.previewed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.skipped).toBe(0);
      const badRow = result.results.find((r) => r.moduleRegistrationId === 'mr-bad');
      expect(badRow?.outcome).toBe('failed');
      expect(badRow?.reason).toMatch(/ModuleRegistration/);
      expect(badRow?.aggregation).toBeNull();
    });

    it('persists rows that have a complete cohort and reports them as persisted', async () => {
      mockedModuleRegistrationRepo.findActiveForCohort.mockResolvedValue([
        { id: 'mr-1', enrolmentId: 'e-1', status: 'REGISTERED' },
      ] as any);
      mockedModuleRegistrationRepo.getById.mockResolvedValue(fakeModuleRegistration as any);
      mockedRepo.findForAggregation.mockResolvedValue([
        { id: 'a-1', assessmentId: 'assess-1', finalMark: 60, maxMark: 100, weighting: 100, status: 'CONFIRMED' },
      ] as any);
      mockedModuleResultsService.create.mockResolvedValue({ id: 'mr-new', status: 'PROVISIONAL' } as any);

      const result = await marksService.generateModuleResultsForCohort(
        'mod-1',
        '2025/26',
        { persist: true },
        'user-1',
        fakeReq,
      );

      expect(result.total).toBe(1);
      expect(result.persisted).toBe(1);
      expect(result.previewed).toBe(0);
      expect(result.results[0].outcome).toBe('persisted');
      expect(result.results[0].aggregation?.aggregatePercentage).toBe(60);
    });

    it('forwards attemptStatuses, boundaryAssessmentId, and force to the per-row aggregator', async () => {
      mockedModuleRegistrationRepo.findActiveForCohort.mockResolvedValue([
        { id: 'mr-1', enrolmentId: 'e-1', status: 'REGISTERED' },
      ] as any);
      mockedModuleRegistrationRepo.getById.mockResolvedValue(fakeModuleRegistration as any);

      await marksService.generateModuleResultsForCohort(
        'mod-1',
        '2025/26',
        {
          attemptStatuses: ['MARKED', 'MODERATED'],
          boundaryAssessmentId: 'assess-boundary',
          persist: true,
          force: true,
        },
        'user-1',
        fakeReq,
      );

      // The cohort generator's first ask of the per-row aggregator is to
      // load the contributing attempts via findForAggregation — confirm
      // the supplied attemptStatuses make it down.
      expect(mockedRepo.findForAggregation).toHaveBeenCalledWith('mr-1', {
        statuses: ['MARKED', 'MODERATED'],
      });

      const events = mockedEmitEvent.mock.calls.map((c) => (typeof c[0] === 'object' ? c[0] : null));
      const batchEvent = events.find((e) => e && e.event === 'module_results.batch_generated');
      expect(batchEvent?.data).toEqual(
        expect.objectContaining({
          attemptStatuses: ['MARKED', 'MODERATED'],
          boundaryAssessmentId: 'assess-boundary',
          persistRequested: true,
          force: true,
        }),
      );
    });

    it('audits the cohort run against the Module entity (not the individual rows)', async () => {
      mockedModuleRegistrationRepo.findActiveForCohort.mockResolvedValue([
        { id: 'mr-1', enrolmentId: 'e-1', status: 'REGISTERED' },
      ] as any);
      mockedModuleRegistrationRepo.getById.mockResolvedValue(fakeModuleRegistration as any);

      await marksService.generateModuleResultsForCohort(
        'mod-1',
        '2025/26',
        {},
        'user-1',
        fakeReq,
      );

      expect(mockedLogAudit).toHaveBeenCalledWith(
        'Module',
        'mod-1',
        'UPDATE',
        'user-1',
        null,
        expect.objectContaining({ moduleId: 'mod-1', academicYear: '2025/26', total: 1 }),
        fakeReq,
      );
    });
  });
});
