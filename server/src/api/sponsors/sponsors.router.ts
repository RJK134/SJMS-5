import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './sponsors.controller';
import {
  createSchema,
  updateSchema,
  querySchema,
  paramsSchema,
} from './sponsors.schema';

export const sponsorsRouter = Router();

sponsorsRouter.get(
  '/',
  validateQuery(querySchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.list,
);

sponsorsRouter.get(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.getById,
);

sponsorsRouter.post(
  '/',
  validate(createSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.create,
);

sponsorsRouter.patch(
  '/:id',
  validateParams(paramsSchema),
  validate(updateSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.update,
);

sponsorsRouter.delete(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.SUPER_ADMIN),
  ctrl.remove,
);
