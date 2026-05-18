import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { scopeToUser } from '../../middleware/data-scope';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './marks.controller';
import {
  createSchema,
  updateSchema,
  querySchema,
  paramsSchema,
  aggregateSchema,
  moderateSchema,
  ratifySchema,
  assignSecondMarkerSchema,
  anonymiseSchema,
} from './marks.schema';

export const marksRouter = Router();

marksRouter.get('/', requireRole(...ROLE_GROUPS.ADMIN_STAFF, ...ROLE_GROUPS.TEACHING, ...ROLE_GROUPS.STUDENTS), scopeToUser('studentId'), validateQuery(querySchema), ctrl.list);

// POST /v1/marks/aggregate — Phase 17A. Roll AssessmentAttempt rows up into a
// module-level aggregate. Mounted before `/:id` so the literal path wins
// over the dynamic route. Restricted to TEACHING staff (the same group that
// can create / update individual marks).
marksRouter.post('/aggregate', validate(aggregateSchema), requireRole(...ROLE_GROUPS.TEACHING), ctrl.aggregate);

// Phase 17B — action-named moderation / ratification endpoints. They drive
// the canonical state-machine transitions through marks.service.update so
// audit and event emission happen on their normal paths. Restricted to
// TEACHING (same group that can mark / amend individual attempts).
marksRouter.post('/:id/moderate', validateParams(paramsSchema), validate(moderateSchema), requireRole(...ROLE_GROUPS.TEACHING), ctrl.moderate);
marksRouter.post('/:id/ratify', validateParams(paramsSchema), validate(ratifySchema), requireRole(...ROLE_GROUPS.TEACHING), ctrl.ratify);

// Workstream C3 — second-marking and anonymous-marking action endpoints
// keyed on the parent AssessmentAttempt id. SecondMarkingRecord-keyed and
// AnonymousMarking-keyed endpoints (record / reconcile / reveal / list)
// live on `/v1/second-marking` and `/v1/anonymous-marking`. Mounted before
// the dynamic `/:id` so the literal action paths win.
marksRouter.post('/:id/assign-second-marker', validateParams(paramsSchema), validate(assignSecondMarkerSchema), requireRole(...ROLE_GROUPS.TEACHING, ...ROLE_GROUPS.REGISTRY), ctrl.assignSecondMarker);
marksRouter.post('/:id/anonymise', validateParams(paramsSchema), validate(anonymiseSchema), requireRole(...ROLE_GROUPS.TEACHING, ...ROLE_GROUPS.REGISTRY), ctrl.anonymise);

marksRouter.get('/:id', validateParams(paramsSchema), requireRole(...ROLE_GROUPS.TEACHING), ctrl.getById);
marksRouter.post('/', validate(createSchema), requireRole(...ROLE_GROUPS.TEACHING), ctrl.create);
marksRouter.patch('/:id', validateParams(paramsSchema), validate(updateSchema), requireRole(...ROLE_GROUPS.TEACHING), ctrl.update);
marksRouter.delete('/:id', validateParams(paramsSchema), requireRole(...ROLE_GROUPS.SUPER_ADMIN), ctrl.remove);
