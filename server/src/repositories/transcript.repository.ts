import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { type CursorPaginationParams, buildCursorPaginatedResponse, safeOrderBy } from '../utils/pagination';
import { TRANSCRIPT_SORT } from '../utils/repository-sort-allow-lists';

export interface TranscriptFilters {
  studentId?: string;
  transcriptType?: string;
}

export async function list(filters: TranscriptFilters = {}, pagination: CursorPaginationParams) {
  const where: Prisma.TranscriptWhereInput = {
    deletedAt: null,
    ...(filters.studentId && { studentId: filters.studentId }),
    ...(filters.transcriptType && { transcriptType: filters.transcriptType as any }),
  };

  const [data, total] = await Promise.all([
    prisma.transcript.findMany({
      where,
      include: { student: { include: { person: true } } },
      take: pagination.limit + 1, ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, TRANSCRIPT_SORT),
    }),
    prisma.transcript.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.transcript.findFirst({
    where: { id, deletedAt: null },
    include: { student: { include: { person: true } }, lines: true },
  });
}

export async function create(data: Prisma.TranscriptUncheckedCreateInput) {
  return prisma.transcript.create({ data });
}

export async function update(id: string, data: Prisma.TranscriptUpdateInput) {
  return prisma.transcript.update({ where: { id }, data });
}

export async function softDelete(id: string) {
  return prisma.transcript.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * Phase 17E — atomic Transcript + TranscriptLine creation.
 *
 * Creates a Transcript row with its TranscriptLine children in a single
 * Prisma nested-write so the transcript is never persisted without its
 * lines. Returns the persisted transcript with lines included so the
 * caller can return the structured payload directly.
 */
export async function createWithLines(
  transcript: Prisma.TranscriptUncheckedCreateInput,
  lines: ReadonlyArray<Omit<Prisma.TranscriptLineUncheckedCreateInput, 'transcriptId'>>,
) {
  return prisma.transcript.create({
    data: {
      ...transcript,
      lines: {
        create: lines.map((l) => ({
          moduleCode: l.moduleCode,
          moduleTitle: l.moduleTitle,
          credits: l.credits,
          mark: l.mark ?? null,
          grade: l.grade ?? null,
          academicYear: l.academicYear,
          sortOrder: l.sortOrder ?? 0,
        })),
      },
    },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });
}
