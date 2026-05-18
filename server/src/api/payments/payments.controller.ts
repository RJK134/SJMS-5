import type { Request, Response, NextFunction } from 'express';
import * as service from './payments.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.list(req.query as unknown as service.PaymentListQuery);
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
 * POST /v1/payments/:id/allocate (Phase 18C).
 *
 * Allocates an existing Payment across the open ChargeLines for its
 * StudentAccount. Defaults: FIFO strategy, persist mutations on a
 * COMPLETED payment.
 */
export async function allocate(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const body = req.body as service.AllocateForPaymentOptions;
    const data = await service.allocateForPayment(
      id,
      body,
      req.user?.sub ?? 'system',
      req,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
