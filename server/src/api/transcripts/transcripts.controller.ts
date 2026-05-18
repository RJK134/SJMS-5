import type { Request, Response, NextFunction } from 'express';
import * as service from './transcripts.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.list(req.query as unknown as service.TranscriptListQuery);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const data = await service.getById(id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.create(req.body, req.user?.sub ?? 'system', req);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const data = await service.update(id, req.body, req.user?.sub ?? 'system', req);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    await service.remove(id, req.user?.sub ?? 'system', req);
    res.status(204).send();
  } catch (err) { next(err); }
}

/**
 * POST /v1/transcripts/compose (Phase 17E).
 *
 * Composes a structured transcript for a student. Defaults to
 * preview-only; persist mode atomically writes a Transcript +
 * TranscriptLine row set.
 */
export async function compose(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { studentId: string } & service.ComposeForStudentOptions;
    const { studentId, ...options } = body;
    const data = await service.composeForStudent(
      studentId,
      options,
      req.user?.sub ?? 'system',
      req,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
