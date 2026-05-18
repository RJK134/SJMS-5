import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './invoices.controller';
import {
  createSchema,
  updateSchema,
  querySchema,
  paramsSchema,
  generateSchema,
} from './invoices.schema';

export const invoicesRouter = Router();

invoicesRouter.get(
  '/',
  validateQuery(querySchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.list,
);

// POST /v1/invoices/generate — Phase 18B. Compose + (optionally) persist
// an invoice from a FeeAssessment. Mounted before `/:id` so the literal
// path wins. FINANCE-role gated (same group authorised to create / amend
// existing Invoice rows).
invoicesRouter.post(
  '/generate',
  validate(generateSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.generate,
);

invoicesRouter.get(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.getById,
);
invoicesRouter.post(
  '/',
  validate(createSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.create,
);
invoicesRouter.patch(
  '/:id',
  validateParams(paramsSchema),
  validate(updateSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.update,
);
invoicesRouter.delete(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.SUPER_ADMIN),
  ctrl.remove,
);
