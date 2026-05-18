import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './anonymous-marking.controller';
import { paramsSchema, querySchema, revealSchema } from './anonymous-marking.schema';

// ── Workstream C3 — anonymous-marking router ────────────────────────────────
//
// Mounts the AnonymousMarking-keyed read + reveal endpoints.
// `POST /v1/marks/:id/anonymise` (keyed on the AssessmentAttempt id)
// remains on the marks router. Reveal is restricted to REGISTRY +
// EXAM_BOARD because disclosure requires a governance-level rationale;
// general teaching staff can read but not reveal.

export const anonymousMarkingRouter = Router();

anonymousMarkingRouter.get(
  '/',
  validateQuery(querySchema),
  requireRole(...ROLE_GROUPS.TEACHING, ...ROLE_GROUPS.REGISTRY),
  ctrl.list,
);

anonymousMarkingRouter.post(
  '/:id/reveal',
  validateParams(paramsSchema),
  validate(revealSchema),
  requireRole(...ROLE_GROUPS.REGISTRY, ...ROLE_GROUPS.EXAM_BOARD),
  ctrl.reveal,
);

anonymousMarkingRouter.get(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.TEACHING, ...ROLE_GROUPS.REGISTRY),
  ctrl.getById,
);
