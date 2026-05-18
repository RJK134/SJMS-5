import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './progressions.controller';
import { createSchema, updateSchema, querySchema, paramsSchema, decideSchema } from './progressions.schema';

export const progressionsRouter = Router();

progressionsRouter.get('/', validateQuery(querySchema), requireRole(...ROLE_GROUPS.REGISTRY), ctrl.list);

// POST /v1/progressions/decide — Phase 17D. Run the progression rules engine
// for one (enrolment, academicYear) pair. Mounted before `/:id` so the
// literal path wins. REGISTRY-role gated (same group that creates / amends
// existing ProgressionRecord rows).
progressionsRouter.post('/decide', validate(decideSchema), requireRole(...ROLE_GROUPS.REGISTRY), ctrl.decide);

progressionsRouter.get('/:id', validateParams(paramsSchema), requireRole(...ROLE_GROUPS.ALL_AUTHENTICATED), ctrl.getById);
progressionsRouter.post('/', validate(createSchema), requireRole(...ROLE_GROUPS.REGISTRY), ctrl.create);
progressionsRouter.patch('/:id', validateParams(paramsSchema), validate(updateSchema), requireRole(...ROLE_GROUPS.REGISTRY), ctrl.update);
progressionsRouter.delete('/:id', validateParams(paramsSchema), requireRole(...ROLE_GROUPS.SUPER_ADMIN), ctrl.remove);
