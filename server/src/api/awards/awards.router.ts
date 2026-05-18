import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './awards.controller';
import { createSchema, updateSchema, querySchema, paramsSchema, classifySchema } from './awards.schema';

export const awardsRouter = Router();

awardsRouter.get('/', validateQuery(querySchema), requireRole(...ROLE_GROUPS.REGISTRY), ctrl.list);

// POST /v1/awards/classify — Phase 17D. Run the award classification rules
// engine for an enrolment. Mounted before `/:id` so the literal path wins.
// REGISTRY-role gated (same group that approves AwardRecord rows).
awardsRouter.post('/classify', validate(classifySchema), requireRole(...ROLE_GROUPS.REGISTRY), ctrl.classify);

awardsRouter.get('/:id', validateParams(paramsSchema), requireRole(...ROLE_GROUPS.ALL_AUTHENTICATED), ctrl.getById);
awardsRouter.post('/', validate(createSchema), requireRole(...ROLE_GROUPS.REGISTRY), ctrl.create);
awardsRouter.patch('/:id', validateParams(paramsSchema), validate(updateSchema), requireRole(...ROLE_GROUPS.REGISTRY), ctrl.update);
awardsRouter.delete('/:id', validateParams(paramsSchema), requireRole(...ROLE_GROUPS.SUPER_ADMIN), ctrl.remove);
