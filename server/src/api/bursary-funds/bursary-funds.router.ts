import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './bursary-funds.controller';
import {
  createSchema,
  updateSchema,
  querySchema,
  paramsSchema,
} from './bursary-funds.schema';

export const bursaryFundsRouter = Router();

bursaryFundsRouter.get(
  '/',
  validateQuery(querySchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.list,
);

bursaryFundsRouter.get(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.getById,
);

bursaryFundsRouter.post(
  '/',
  validate(createSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.create,
);

bursaryFundsRouter.patch(
  '/:id',
  validateParams(paramsSchema),
  validate(updateSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.update,
);

bursaryFundsRouter.delete(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.SUPER_ADMIN),
  ctrl.remove,
);
