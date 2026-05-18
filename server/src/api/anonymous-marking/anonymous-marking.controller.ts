import type { Request, Response, NextFunction } from 'express';
import * as service from '../marks/anonymous-marking.service';

// ── Workstream C3 — anonymous-marking controllers ───────────────────────────
//
// The marks-level `/v1/marks/:id/anonymise` action lives on the existing
// marks router because it is keyed on an AssessmentAttempt id; the
// AnonymousMarking-keyed routes (list / getById / reveal) live on the
// dedicated `/v1/anonymous-marking` router.

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.list(req.query as unknown as service.AnonymousMarkingListQuery);
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

export async function reveal(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const data = await service.reveal(
      id,
      req.body as service.RevealOptions,
      req.user?.sub ?? 'system',
      req,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
