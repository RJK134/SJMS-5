import type { Request, Response, NextFunction } from 'express';
import * as service from './hesa.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.list(req.query as unknown as service.HesaNotificationListQuery);
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

// ── Workstream C2 — return composition / validation / export handlers ──────

export async function composeReturn(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.composeReturn(
      req.body,
      req.user?.sub ?? 'system',
      req,
    );
    res.status(200).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function validateReturn(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const result = await service.validateReturn(
      id,
      req.body ?? {},
      req.user?.sub ?? 'system',
      req,
    );
    res.status(200).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function exportReturn(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const format = ((req.query.format as string) || 'csv').toLowerCase() as service.HesaExportFormat;
    const result = await service.exportReturn(
      id,
      format,
      req.user?.sub ?? 'system',
      req,
    );
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.status(200).send(result.body);
  } catch (err) { next(err); }
}
