import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './sponsor-invoices.controller';
import {
  createSchema,
  updateSchema,
  querySchema,
  paramsSchema,
} from './sponsor-invoices.schema';

export const sponsorInvoicesRouter = Router();

sponsorInvoicesRouter.get(
  '/',
  validateQuery(querySchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.list,
);

sponsorInvoicesRouter.get(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.getById,
);

sponsorInvoicesRouter.post(
  '/',
  validate(createSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.create,
);

sponsorInvoicesRouter.patch(
  '/:id',
  validateParams(paramsSchema),
  validate(updateSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.update,
);

sponsorInvoicesRouter.delete(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.SUPER_ADMIN),
  ctrl.remove,
);
