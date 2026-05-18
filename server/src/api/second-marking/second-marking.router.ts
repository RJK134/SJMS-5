import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './second-marking.controller';
import {
  paramsSchema,
  querySchema,
  recordSecondMarkSchema,
  reconcileSchema,
} from './second-marking.schema';

// ── Workstream C3 — second-marking router ───────────────────────────────────
//
// Mounts the SecondMarkingRecord-keyed action endpoints. The
// AssessmentAttempt-keyed `assign-second-marker` endpoint lives on the
// existing `/v1/marks/:id/assign-second-marker` route in marks.router.ts
// because the parameter is an attempt id rather than a record id.
//
// All routes are restricted to TEACHING + REGISTRY (the same groups
// already authorised to mark and amend attempts in Phase 17B).

export const secondMarkingRouter = Router();

secondMarkingRouter.get(
  '/',
  validateQuery(querySchema),
  requireRole(...ROLE_GROUPS.TEACHING, ...ROLE_GROUPS.REGISTRY),
  ctrl.list,
);

// Action endpoints mounted before the dynamic `/:id` so the literal paths win.
secondMarkingRouter.post(
  '/:id/record-second-mark',
  validateParams(paramsSchema),
  validate(recordSecondMarkSchema),
  requireRole(...ROLE_GROUPS.TEACHING, ...ROLE_GROUPS.REGISTRY),
  ctrl.recordSecondMark,
);

secondMarkingRouter.post(
  '/:id/reconcile',
  validateParams(paramsSchema),
  validate(reconcileSchema),
  requireRole(...ROLE_GROUPS.TEACHING, ...ROLE_GROUPS.REGISTRY),
  ctrl.reconcile,
);

secondMarkingRouter.get(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.TEACHING, ...ROLE_GROUPS.REGISTRY),
  ctrl.getById,
);
