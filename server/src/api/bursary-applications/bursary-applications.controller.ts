import type { Request, Response, NextFunction } from 'express';
import * as service from './bursary-applications.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.list(req.query as unknown as service.BursaryApplicationListQuery);
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
    res.status(204).end();
  } catch (err) { next(err); }
}

/**
 * POST /v1/bursary-applications/:id/auto-decide (Phase 1C).
 *
 * Runs the bursary eligibility rule engine against the application and
 * (by default) persists the resulting status / award atomically with the
 * fund's budget update.
 */
export async function autoDecide(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const data = await service.autoDecideForApplication(
      id,
      req.body as service.AutoDecideOptions,
      req.user?.sub ?? 'system',
      req,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
