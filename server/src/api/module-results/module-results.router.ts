import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './module-results.controller';
import { createSchema, updateSchema, querySchema, paramsSchema, ratifySchema, generateSchema } from './module-results.schema';

export const moduleResultsRouter = Router();

moduleResultsRouter.get('/', validateQuery(querySchema), requireRole(...ROLE_GROUPS.TEACHING), ctrl.list);

// POST /v1/module-results/generate — Phase 17C. Cohort-level batch
// generation. Mounted before the `/:id` dynamic routes so the literal
// path wins. Restricted to TEACHING (same group that can mark / amend
// individual marks and ratify ModuleResult rows).
moduleResultsRouter.post('/generate', validate(generateSchema), requireRole(...ROLE_GROUPS.TEACHING), ctrl.generate);

moduleResultsRouter.get('/:id', validateParams(paramsSchema), requireRole(...ROLE_GROUPS.ALL_AUTHENTICATED), ctrl.getById);
moduleResultsRouter.post('/', validate(createSchema), requireRole(...ROLE_GROUPS.TEACHING), ctrl.create);

// Phase 17B — action-named ratification endpoint. Restricted to TEACHING
// (academics propose ratification at the exam board; SUPER_ADMIN keeps
// the destructive remove route). Drives the canonical PROVISIONAL →
// CONFIRMED transition through `update()` so the cross-entity guard,
// audit, and `module_results.ratified` event all fire on their normal
// path.
moduleResultsRouter.post('/:id/ratify', validateParams(paramsSchema), validate(ratifySchema), requireRole(...ROLE_GROUPS.TEACHING), ctrl.ratify);

moduleResultsRouter.patch('/:id', validateParams(paramsSchema), validate(updateSchema), requireRole(...ROLE_GROUPS.TEACHING), ctrl.update);
moduleResultsRouter.delete('/:id', validateParams(paramsSchema), requireRole(...ROLE_GROUPS.SUPER_ADMIN), ctrl.remove);
