import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './payment-plans.controller';
import {
  createSchema,
  updateSchema,
  querySchema,
  paramsSchema,
  generateSchema,
} from './payment-plans.schema';

export const paymentPlansRouter = Router();

paymentPlansRouter.get(
  '/',
  validateQuery(querySchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.list,
);

// POST /v1/payment-plans/generate — Phase 18D. Generates a plan +
// schedule from a single call. Mounted before `/:id` so the literal
// action path wins over the dynamic match.
paymentPlansRouter.post(
  '/generate',
  validate(generateSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.generate,
);

paymentPlansRouter.get(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.getById,
);

paymentPlansRouter.post(
  '/',
  validate(createSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.create,
);

paymentPlansRouter.patch(
  '/:id',
  validateParams(paramsSchema),
  validate(updateSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.update,
);

paymentPlansRouter.delete(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.SUPER_ADMIN),
  ctrl.remove,
);
