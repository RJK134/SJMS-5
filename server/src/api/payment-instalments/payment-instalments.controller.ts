import type { Request, Response, NextFunction } from 'express';
import * as service from './payment-instalments.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.list(req.query as unknown as service.PaymentInstalmentListQuery);
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
 * POST /v1/payment-instalments/:id/record-payment (Phase 18D bridge).
 *
 * Records a Payment against this instalment by driving the 18C
 * allocator and flipping the instalment to COMPLETED. Promotes the
 * parent PaymentPlan to COMPLETED when every instalment is now
 * COMPLETED.
 */
export async function recordPayment(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const body = req.body as service.RecordPaymentOptions;
    const data = await service.recordPayment(
      id,
      body,
      req.user?.sub ?? 'system',
      req,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
