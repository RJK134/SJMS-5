import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './ledger-anomalies.controller';
import { scanSchema } from './ledger-anomalies.schema';

export const ledgerAnomaliesRouter = Router();

// POST /v1/ledger-anomalies/scan (Phase 1E). On-demand finance ledger
// anomaly scan (negative balances, orphan ChargeLines, duplicate invoice
// numbers). FINANCE-role gated — the same group that owns the finance
// domain. Read-only: surfaces anomalies for an operator to act on; never
// mutates the ledger.
ledgerAnomaliesRouter.post(
  '/scan',
  validate(scanSchema),
  requireRole(...ROLE_GROUPS.FINANCE),
  ctrl.scan,
);
