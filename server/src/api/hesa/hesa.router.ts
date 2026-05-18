import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './hesa.controller';
import {
  createSchema,
  updateSchema,
  querySchema,
  paramsSchema,
  composeReturnSchema,
  validateReturnSchema,
  exportReturnQuerySchema,
} from './hesa.schema';

export const hesaRouter = Router();

// ─── HESA notification queue (existing CRUD — unchanged) ──────────────────
hesaRouter.get('/notifications', validateQuery(querySchema), requireRole(...ROLE_GROUPS.ADMIN_STAFF), ctrl.list);
hesaRouter.get('/notifications/:id', validateParams(paramsSchema), requireRole(...ROLE_GROUPS.ADMIN_STAFF), ctrl.getById);
hesaRouter.post('/notifications', validate(createSchema), requireRole(...ROLE_GROUPS.ADMIN_STAFF), ctrl.create);
hesaRouter.patch('/notifications/:id', validateParams(paramsSchema), validate(updateSchema), requireRole(...ROLE_GROUPS.ADMIN_STAFF), ctrl.update);
hesaRouter.delete('/notifications/:id', validateParams(paramsSchema), requireRole(...ROLE_GROUPS.SUPER_ADMIN), ctrl.remove);

// ─── Workstream C2 — HESA return composition / validation / export ────────
// Action paths are mounted before any future dynamic /:id routes on the
// /returns prefix so the literal path always wins.
hesaRouter.post(
  '/returns/compose',
  validate(composeReturnSchema),
  requireRole(...ROLE_GROUPS.COMPLIANCE),
  ctrl.composeReturn,
);
hesaRouter.post(
  '/returns/:id/validate',
  validateParams(paramsSchema),
  validate(validateReturnSchema),
  requireRole(...ROLE_GROUPS.COMPLIANCE),
  ctrl.validateReturn,
);
hesaRouter.get(
  '/returns/:id/export',
  validateParams(paramsSchema),
  validateQuery(exportReturnQuerySchema),
  requireRole(...ROLE_GROUPS.COMPLIANCE),
  ctrl.exportReturn,
);
