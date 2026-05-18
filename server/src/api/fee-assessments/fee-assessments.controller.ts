import type { Request, Response, NextFunction } from 'express';
import * as service from './fee-assessments.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.list(req.query as unknown as service.FeeAssessmentListQuery);
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

/**
 * POST /v1/fee-assessments/assess (Phase 18A).
 *
 * Calculates a fee for a single enrolment via the canonical rules
 * engine. Defaults are preview-safe — see service docs.
 */
export async function assess(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { enrolmentId: string } & service.AssessForEnrolmentOptions;
    const { enrolmentId, ...options } = body;
    const data = await service.assessForEnrolment(
      enrolmentId,
      options,
      req.user?.sub ?? 'system',
      req,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
