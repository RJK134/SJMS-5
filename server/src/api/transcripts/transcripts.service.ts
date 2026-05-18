import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/transcript.repository';
import * as studentRepo from '../../repositories/student.repository';
import * as enrolmentRepo from '../../repositories/enrolment.repository';
import * as moduleResultRepo from '../../repositories/moduleResult.repository';
import * as awardRecordRepo from '../../repositories/awardRecord.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';
import {
  composeTranscript,
  type ComposeTranscriptInput,
  type TranscriptComposition,
  type TranscriptType,
  type ModuleResultForTranscript,
} from '../../utils/transcript-composition';

export interface TranscriptListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  studentId?: string;
  transcriptType?: string;
}

export async function list(query: TranscriptListQuery) {
  const { cursor, limit, sort, order, studentId, transcriptType } = query;
  return repo.list(
    { studentId, transcriptType },
    { cursor, limit, sort, order },
  );
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('Transcript', id);
  return result;
}

export async function create(data: Prisma.TranscriptUncheckedCreateInput, userId: string, req: Request) {
  const result = await repo.create(data);
  await logAudit('Transcript', result.id, 'CREATE', userId, null, result, req);
  emitEvent({
    event: 'transcripts.created',
    entityType: 'Transcript',
    entityId: result.id,
    actorId: userId,
    data: {
      studentId: result.studentId,
      transcriptType: (result as { transcriptType?: string }).transcriptType ?? null,
    },
  });
  return result;
}

export async function update(id: string, data: Prisma.TranscriptUpdateInput, userId: string, req: Request) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('Transcript', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'transcripts.updated',
    entityType: 'Transcript',
    entityId: id,
    actorId: userId,
    data: {
      studentId: result.studentId,
      transcriptType: (result as { transcriptType?: string }).transcriptType ?? null,
    },
  });
  return result;
}

export async function remove(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  await repo.softDelete(id);
  await logAudit('Transcript', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'transcripts.deleted',
    entityType: 'Transcript',
    entityId: id,
    actorId: userId,
    data: { studentId: previous.studentId },
  });
}

// ── Transcript composition (Phase 17E) ───────────────────────────────────────
//
// Composes a structured transcript from a student's CONFIRMED ModuleResults
// plus their AwardRecord (when classified). Pure arithmetic and layout is
// delegated to `utils/transcript-composition`; this function loads the
// inputs and (in persist mode) writes a Transcript + TranscriptLine row
// set through the repository's atomic `createWithLines` helper so the
// transcript is never persisted without its body.
//
// Two operating modes:
//
//   preview  (default)  — compose the transcript payload, do NOT touch
//                         Transcript / TranscriptLine. Used by the
//                         student portal "view my transcript" path so
//                         the page can render a current snapshot
//                         without spawning a row per visit.
//   persist  (opt-in)   — additionally write a Transcript + TranscriptLine
//                         row set through `transcripts.repository.createWithLines`.
//                         Used by Registry when issuing an interim or
//                         final transcript that needs an immutable record
//                         of issuance.
//
// FINAL transcripts require an AwardRecord — a non-final composition will
// be returned (with a note) but `isFinal` is set to false so the caller
// can refuse to persist.

/** Inputs accepted by the composer. */
export interface ComposeForStudentOptions {
  /** Transcript type — defaults to INTERIM if not supplied. */
  transcriptType?: TranscriptType;
  /** When supplied, only ModuleResults from this enrolment are included. */
  enrolmentId?: string;
  /** Persist a Transcript + TranscriptLine row set. Defaults to false (preview). */
  persist?: boolean;
  /**
   * Override the FINAL precondition (AwardRecord must exist) for
   * operational repair / replacement issues. No effect unless persist=true.
   */
  force?: boolean;
}

/** Outcome returned by the service. */
export interface ComposeForStudentResult {
  /** The composed transcript payload — caller can render directly. */
  composition: TranscriptComposition;
  /** True iff a Transcript row was persisted on this call. */
  persisted: boolean;
  /** Set when persisted; null on preview. */
  transcriptId: string | null;
  /** Number of TranscriptLine rows persisted; 0 on preview. */
  lineCount: number;
}

/**
 * Compose a transcript for a single student. Pure layout / formatting is
 * delegated to `utils/transcript-composition`; this function is the I/O
 * orchestrator.
 *
 * @throws NotFoundError when the student does not exist.
 * @throws ValidationError when persist=true is requested but the FINAL
 *   precondition (AwardRecord exists and is non-REVOKED) is not met,
 *   unless force=true is also supplied.
 */
export async function composeForStudent(
  studentId: string,
  options: ComposeForStudentOptions,
  userId: string,
  req: Request,
): Promise<ComposeForStudentResult> {
  const student = await studentRepo.getById(studentId);
  if (!student) throw new NotFoundError('Student', studentId);

  // Pick the enrolment to compose against. When the caller specifies
  // an explicit enrolmentId, use it; otherwise default to the most
  // recent non-deleted enrolment from the rich include the student
  // repo provides.
  const studentWithEnrolments = student as unknown as {
    id: string;
    studentNumber: string;
    person?: { firstName?: string; lastName?: string; dateOfBirth?: Date | string | null };
    enrolments?: Array<{ id: string; programmeId: string; status?: string; createdAt?: Date }>;
  };
  const enrolments = studentWithEnrolments.enrolments ?? [];
  const enrolment = options.enrolmentId
    ? enrolments.find((e) => e.id === options.enrolmentId)
    : enrolments[0];
  if (!enrolment) {
    throw new ValidationError(
      `Student ${studentId} has no enrolment to compose a transcript against` +
        (options.enrolmentId ? ` (requested enrolmentId ${options.enrolmentId} not found).` : '.'),
    );
  }

  // Load programme details for the header. The student include doesn't
  // pull programme through enrolment, so resolve it via the enrolment
  // repository.
  const enrolmentDetail = await enrolmentRepo.getById(enrolment.id);
  if (!enrolmentDetail) {
    throw new NotFoundError('Enrolment', enrolment.id);
  }
  const programme = (enrolmentDetail as unknown as {
    programme?: { id: string; programmeCode: string; title: string; level: string; awardingBody: string };
  }).programme;
  if (!programme) {
    throw new ValidationError(
      `Enrolment ${enrolment.id} has no programme — cannot compose transcript header.`,
    );
  }

  // Load the body — every CONFIRMED ModuleResult under the enrolment.
  // Reuses the 17D `findForEnrolment` helper.
  const moduleResults = await moduleResultRepo.findForEnrolment(enrolment.id, {
    statuses: ['CONFIRMED'],
  });

  // The 17D `findForEnrolment` ModuleResult projection carries credits
  // and level but not moduleCode / title. Resolve those from the
  // enrolment's moduleRegistrations include (already populated on
  // `enrolmentRepo.getById`), so we don't need a parallel module
  // repository fetch. Any ModuleResult referencing a module that
  // can't be resolved is rendered with a placeholder title; the
  // composer surfaces this in `notes`.
  const moduleLookup = new Map<string, { moduleCode: string; title: string }>();
  const enrolmentWithRegs = enrolmentDetail as unknown as {
    moduleRegistrations?: Array<{ moduleId: string; module?: { moduleCode: string; title: string } }>;
  };
  for (const mr of enrolmentWithRegs.moduleRegistrations ?? []) {
    if (mr.module) {
      moduleLookup.set(mr.moduleId, {
        moduleCode: mr.module.moduleCode,
        title: mr.module.title,
      });
    }
  }

  const moduleResultsForTranscript: ModuleResultForTranscript[] = moduleResults.map((r) => ({
    id: r.id,
    moduleId: r.moduleId,
    moduleCode: moduleLookup.get(r.moduleId)?.moduleCode ?? r.moduleId,
    moduleTitle: moduleLookup.get(r.moduleId)?.title ?? '(module title unavailable)',
    credits: r.credits,
    aggregateMark: r.aggregateMark,
    grade: r.grade,
    academicYear: r.academicYear,
    status: r.status,
  }));

  // Optional AwardRecord — null is a valid INTERIM transcript scenario.
  const award = await awardRecordRepo.findByEnrolment(enrolment.id);

  const transcriptType: TranscriptType = options.transcriptType ?? 'INTERIM';

  const generatedDate = new Date();

  const composition = composeTranscript({
    student: {
      id: studentWithEnrolments.id,
      studentNumber: studentWithEnrolments.studentNumber,
      fullName: [
        studentWithEnrolments.person?.firstName ?? '',
        studentWithEnrolments.person?.lastName ?? '',
      ].filter(Boolean).join(' ') || '(name unavailable)',
      dateOfBirth: studentWithEnrolments.person?.dateOfBirth
        ? (studentWithEnrolments.person.dateOfBirth instanceof Date
          ? studentWithEnrolments.person.dateOfBirth.toISOString().slice(0, 10)
          : String(studentWithEnrolments.person.dateOfBirth))
        : null,
    },
    programme: {
      id: programme.id,
      programmeCode: programme.programmeCode,
      title: programme.title,
      level: programme.level,
      awardingBody: programme.awardingBody,
    },
    moduleResults: moduleResultsForTranscript,
    award: award
      ? {
          id: award.id,
          awardTitle: award.awardTitle,
          classification: award.classification ?? null,
          finalAverage: award.finalAverage != null ? Number(award.finalAverage) : null,
          awardDate: award.awardDate
            ? award.awardDate.toISOString().slice(0, 10)
            : null,
          status: award.status as unknown as string,
        }
      : null,
    transcriptType,
    generatedDate,
    generatedBy: userId,
  } as ComposeTranscriptInput);

  let persisted = false;
  let transcriptId: string | null = null;
  let lineCount = 0;

  if (options.persist === true) {
    if (transcriptType === 'FINAL' && !composition.isFinal && options.force !== true) {
      throw new ValidationError(
        `Cannot persist a FINAL transcript for student ${studentId}: ${composition.notes.join(' ')} ` +
          `Re-run with force: true to override.`,
      );
    }

    const created = await repo.createWithLines(
      {
        studentId: studentWithEnrolments.id,
        transcriptType: transcriptType as Prisma.TranscriptUncheckedCreateInput['transcriptType'],
        generatedDate,
        generatedBy: userId,
        // The Json columns mirror the structured payload so downstream
        // PDF / portal renderers can read straight off the row.
        modules: composition.lines as unknown as Prisma.InputJsonValue,
        awards: (composition.award ?? null) as unknown as Prisma.InputJsonValue,
      },
      composition.lines.map((l) => ({
        moduleCode: l.moduleCode,
        moduleTitle: l.moduleTitle,
        credits: l.credits,
        mark: l.mark ?? null,
        grade: l.grade ?? null,
        academicYear: l.academicYear,
        sortOrder: l.sortOrder,
      })),
    );
    transcriptId = created.id;
    lineCount = (created as unknown as { lines?: unknown[] }).lines?.length ?? composition.lines.length;
    persisted = true;
  }

  await logAudit(
    persisted ? 'Transcript' : 'Student',
    persisted ? (transcriptId as string) : studentId,
    persisted ? 'CREATE' : 'EXPORT',
    userId,
    null,
    {
      transcriptType,
      enrolmentId: enrolment.id,
      lineCount: composition.lines.length,
      finalAverage: composition.totals.finalAverage,
      classification: composition.award?.classification ?? null,
      isFinal: composition.isFinal,
      persisted,
      transcriptId,
    } as Record<string, unknown>,
    req,
  );

  emitEvent({
    event: 'transcripts.composed',
    entityType: 'Student',
    entityId: studentId,
    actorId: userId,
    data: {
      studentId,
      enrolmentId: enrolment.id,
      programmeId: programme.id,
      transcriptType,
      lineCount: composition.lines.length,
      totalCredits: composition.totals.totalCredits,
      finalAverage: composition.totals.finalAverage,
      classification: composition.award?.classification ?? null,
      isFinal: composition.isFinal,
      notes: composition.notes,
      persisted,
      transcriptId,
      force: options.force === true,
    },
  });

  return { composition, persisted, transcriptId, lineCount };
}
