import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './fee-assessments.controller';
import {
  createSchema,
  updateSchema,
  querySchema,
  paramsSchema,
  assessSchema,
} from './fee-assessments.schema';

export const feeAssessmentsRouter = Router();

feeAssessmentsRouter.get(
  '/',
  validateQuery(querySchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.list,
);

// POST /v1/fee-assessments/assess — Phase 18A. Run the fee calculation
// engine for a single enrolment. Mounted before `/:id` so the literal
// path wins. FINANCE-role gated (same group that creates / amends
// existing FeeAssessment rows).
feeAssessmentsRouter.post(
  '/assess',
  validate(assessSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.assess,
);

feeAssessmentsRouter.get(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.getById,
);
feeAssessmentsRouter.post(
  '/',
  validate(createSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.create,
);
feeAssessmentsRouter.patch(
  '/:id',
  validateParams(paramsSchema),
  validate(updateSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.update,
);
