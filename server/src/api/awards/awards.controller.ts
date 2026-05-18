import type { Request, Response, NextFunction } from 'express';
import * as service from './awards.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.list(req.query as unknown as service.AwardListQuery);
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
 * POST /v1/awards/classify (Phase 17D).
 *
 * Classifies a degree outcome for a single enrolment via the canonical
 * rules engine. Defaults are preview-safe — see service docs.
 */
export async function classify(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { enrolmentId: string } & service.ClassifyAwardOptions;
    const { enrolmentId, ...options } = body;
    const data = await service.classifyForEnrolment(
      enrolmentId,
      options,
      req.user?.sub ?? 'system',
      req,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
