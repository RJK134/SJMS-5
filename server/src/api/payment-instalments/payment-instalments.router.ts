import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './payment-instalments.controller';
import {
  updateSchema,
  querySchema,
  paramsSchema,
  recordPaymentSchema,
} from './payment-instalments.schema';

export const paymentInstalmentsRouter = Router();

paymentInstalmentsRouter.get(
  '/',
  validateQuery(querySchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.list,
);

paymentInstalmentsRouter.get(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.getById,
);

paymentInstalmentsRouter.patch(
  '/:id',
  validateParams(paramsSchema),
  validate(updateSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.update,
);

// POST /v1/payment-instalments/:id/record-payment — Phase 18D bridge
// to the 18C allocator. FINANCE-role gated. Mounted before any
// dynamic route that could collide with the literal action path.
paymentInstalmentsRouter.post(
  '/:id/record-payment',
  validateParams(paramsSchema),
  validate(recordPaymentSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.recordPayment,
);

paymentInstalmentsRouter.delete(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.SUPER_ADMIN),
  ctrl.remove,
);
