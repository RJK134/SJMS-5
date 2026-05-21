import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './bursary-applications.controller';
import {
  createSchema,
  updateSchema,
  querySchema,
  paramsSchema,
  autoDecideSchema,
} from './bursary-applications.schema';

export const bursaryApplicationsRouter = Router();

bursaryApplicationsRouter.get(
  '/',
  validateQuery(querySchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.list,
);

// POST /v1/bursary-applications/:id/auto-decide (Phase 1C). Mounted
// before the dynamic `/:id` PATCH/GET routes so the literal action
// path wins. FINANCE-role gated (same group that does manual override).
bursaryApplicationsRouter.post(
  '/:id/auto-decide',
  validateParams(paramsSchema),
  validate(autoDecideSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.autoDecide,
);

bursaryApplicationsRouter.get(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.getById,
);

bursaryApplicationsRouter.post(
  '/',
  validate(createSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.create,
);

bursaryApplicationsRouter.patch(
  '/:id',
  validateParams(paramsSchema),
  validate(updateSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.update,
);

bursaryApplicationsRouter.delete(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.SUPER_ADMIN),
  ctrl.remove,
);
