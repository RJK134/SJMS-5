import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './payments.controller';
import {
  createSchema,
  updateSchema,
  querySchema,
  paramsSchema,
  allocateSchema,
} from './payments.schema';

export const paymentsRouter = Router();

paymentsRouter.get(
  '/',
  validateQuery(querySchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.list,
);

paymentsRouter.get(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.getById,
);

paymentsRouter.post(
  '/',
  validate(createSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.create,
);

paymentsRouter.patch(
  '/:id',
  validateParams(paramsSchema),
  validate(updateSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.update,
);

// POST /v1/payments/:id/allocate — Phase 18C. Allocate the payment
// against the open charges on its StudentAccount. FINANCE-role gated.
paymentsRouter.post(
  '/:id/allocate',
  validateParams(paramsSchema),
  validate(allocateSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.allocate,
);

paymentsRouter.delete(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.SUPER_ADMIN),
  ctrl.remove,
);
