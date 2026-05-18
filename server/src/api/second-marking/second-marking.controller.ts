import type { Request, Response, NextFunction } from 'express';
import * as service from '../marks/second-marking.service';

// ── Workstream C3 — second-marking controllers ──────────────────────────────
//
// Thin handlers that bind the HTTP layer to the action functions in
// `marks/second-marking.service`. The service layer holds all business
// logic (independence guards, tolerance rules, reconciliation
// propagation); this layer extracts request data, calls the service,
// and serialises the response.

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = req.query as unknown as service.SecondMarkingListQuery & { markerId?: string; status?: string };
    // The brief's canonical query name is `markerId` but the repo / service
    // layer is keyed on `secondMarkerId`. Accept either; canonicalise to
    // secondMarkerId before delegating.
    const merged: service.SecondMarkingListQuery = {
      cursor: query.cursor,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
      ...(query.attemptId ? { attemptId: query.attemptId } : {}),
      ...(query.assessmentId ? { assessmentId: query.assessmentId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...((query.secondMarkerId ?? query.markerId)
        ? { secondMarkerId: (query.secondMarkerId ?? query.markerId) as string }
        : {}),
      ...(query.reconciled !== undefined
        ? { reconciled: query.reconciled }
        : query.status === 'RECONCILED'
          ? { reconciled: true }
          : {}),
    };
    const result = await service.list(merged);
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

export async function recordSecondMark(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const data = await service.recordSecondMark(
      id,
      req.body as service.RecordSecondMarkOptions,
      req.user?.sub ?? 'system',
      req,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function reconcile(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const data = await service.reconcileMarks(
      id,
      req.body as service.ReconcileMarksOptions,
      req.user?.sub ?? 'system',
      req,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
