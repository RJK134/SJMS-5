import type { Request, Response, NextFunction } from 'express';
import * as service from './marks.service';
import * as secondMarkingService from './second-marking.service';
import * as anonymousMarkingService from './anonymous-marking.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.list(req.query as unknown as service.MarkListQuery);
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
 * POST /v1/marks/:id/moderate (Phase 17B).
 *
 * Records moderation outcome on an AssessmentAttempt and drives the
 * MARKED → MODERATED transition through the canonical update() flow.
 */
export async function moderate(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const data = await service.moderateAttempt(
      id,
      req.body as service.ModerateAttemptInput,
      req.user?.sub ?? 'system',
      req,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * POST /v1/marks/:id/ratify (Phase 17B).
 *
 * Drives the MODERATED → CONFIRMED transition. finalMark and grade are
 * optional; the service auto-derives them from the existing moderatedMark
 * / rawMark and the Assessment's GradeBoundary set when omitted.
 */
export async function ratify(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const data = await service.ratifyAttempt(
      id,
      req.body as service.RatifyAttemptInput,
      req.user?.sub ?? 'system',
      req,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * POST /v1/marks/aggregate (Phase 17A).
 *
 * Aggregates a moduleRegistration's AssessmentAttempt rows into a single
 * weighted-average percentage and (optionally) upserts a ModuleResult
 * with that aggregate. Defaults are preview-safe — see service docs.
 */
export async function aggregate(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { moduleRegistrationId: string } & service.AggregationOptions;
    const { moduleRegistrationId, ...options } = body;
    const data = await service.aggregateForModuleRegistration(
      moduleRegistrationId,
      options,
      req.user?.sub ?? 'system',
      req,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * POST /v1/marks/:id/assign-second-marker (Workstream C3).
 *
 * Assigns a second marker to an AssessmentAttempt by creating a fresh
 * SecondMarkingRecord. Independence guard rejects when the assigned
 * second marker is the same user who marked the attempt; double-assignment
 * is rejected unless `force: true`. See `second-marking.service.assignSecondMarker`.
 */
export async function assignSecondMarker(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const data = await secondMarkingService.assignSecondMarker(
      id,
      req.body as secondMarkingService.AssignSecondMarkerOptions,
      req.user?.sub ?? 'system',
      req,
    );
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * POST /v1/marks/:id/anonymise (Workstream C3).
 *
 * Anonymises an AssessmentAttempt by creating a fresh AnonymousMarking
 * row with a generated `anonymousId`. The marker-facing label appears
 * on every subsequent moderation / second-marking surface so the
 * candidate's identity is hidden. Reveal flips the row append-only and
 * requires a justification (see `/v1/anonymous-marking/:id/reveal`).
 */
export async function anonymise(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const data = await anonymousMarkingService.anonymise(
      id,
      req.body as anonymousMarkingService.AnonymiseOptions,
      req.user?.sub ?? 'system',
      req,
    );
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}
