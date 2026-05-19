import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './refund-approvals.controller';
import {
  createSchema,
  updateSchema,
  querySchema,
  paramsSchema,
  approveSchema,
  rejectSchema,
  processSchema,
} from './refund-approvals.schema';

export const refundApprovalsRouter = Router();

// ── Reads ─────────────────────────────────────────────────────────────────
// REGISTRY and FINANCE both need read access — registry to see what's queued,
// finance to action it. We open list / read to both groups via the union of
// REGISTRY + FINANCE rather than gating to FINANCE only as the original
// scaffold did.

const REFUND_READERS = [...ROLE_GROUPS.REGISTRY, ...ROLE_GROUPS.FINANCE] as const;

refundApprovalsRouter.get(
  '/',
  validateQuery(querySchema),
  requireRole(...REFUND_READERS),
  ctrl.list,
);

refundApprovalsRouter.get(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...REFUND_READERS),
  ctrl.getById,
);

// ── Phase 1D: REGISTRY proposes ───────────────────────────────────────────
// Create always opens at REQUESTED (the service forces it). This is the
// "propose" half of the two-step separation-of-duties workflow.

refundApprovalsRouter.post(
  '/',
  validate(createSchema),
  requireRole(...ROLE_GROUPS.REGISTRY),
  ctrl.create,
);

// ── Phase 1D: FINANCE actions ─────────────────────────────────────────────
// Decision transitions go through dedicated routes so role gates and audit
// events stay sharp. The generic PATCH (below) is restricted to SUPER_ADMIN
// so a FINANCE user cannot back-door an approval by smuggling status via
// the metadata path.

refundApprovalsRouter.post(
  '/:id/approve',
  validateParams(paramsSchema),
  validate(approveSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.approve,
);

refundApprovalsRouter.post(
  '/:id/reject',
  validateParams(paramsSchema),
  validate(rejectSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.reject,
);

refundApprovalsRouter.post(
  '/:id/process',
  validateParams(paramsSchema),
  validate(processSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.process,
);

// ── Clerical edits (SUPER_ADMIN only) ─────────────────────────────────────
// Generic PATCH stays for correcting clerical errors in the free-text
// `reason` or `amount` BEFORE a decision lands. Restricting to SUPER_ADMIN
// removes the "PATCH-as-approval" back-door — any FINANCE user wanting to
// move state must go through the dedicated transition endpoints above.

refundApprovalsRouter.patch(
  '/:id',
  validateParams(paramsSchema),
  validate(updateSchema),
  requireRole(...ROLE_GROUPS.SUPER_ADMIN),
  ctrl.update,
);

refundApprovalsRouter.delete(
  '/:id',
  validateParams(paramsSchema),
  requireRole(...ROLE_GROUPS.SUPER_ADMIN),
  ctrl.remove,
);
