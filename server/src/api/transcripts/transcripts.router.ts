import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { validate, validateParams, validateQuery } from '../../middleware/validate';
import { scopeToUser, requireOwnership, ownerLookup } from '../../middleware/data-scope';
import { ROLE_GROUPS } from '../../constants/roles';
import * as ctrl from './transcripts.controller';
import { createSchema, updateSchema, querySchema, paramsSchema, composeSchema } from './transcripts.schema';

export const transcriptsRouter = Router();

// Phase 17E — list widened from REGISTRY-only to ADMIN_STAFF + TEACHING +
// STUDENTS so the student portal MyTranscript page can render the
// authenticated student's own transcripts. `scopeToUser('studentId')`
// pins the studentId filter to the authenticated user's scope when the
// caller is a student.
transcriptsRouter.get('/', requireRole(...ROLE_GROUPS.ADMIN_STAFF, ...ROLE_GROUPS.TEACHING, ...ROLE_GROUPS.STUDENTS), scopeToUser('studentId'), validateQuery(querySchema), ctrl.list);

// POST /v1/transcripts/compose — Phase 17E. Compose a structured
// transcript and (optionally) persist it. Mounted before `/:id` so the
// literal path wins. REGISTRY-only because issuing a transcript is a
// registry action; students view their persisted transcripts via the
// scoped list above.
transcriptsRouter.post('/compose', validate(composeSchema), requireRole(...ROLE_GROUPS.REGISTRY), ctrl.compose);

// GET /v1/transcripts/:id — restricted to the same role groups as the list
// endpoint. `requireOwnership` ensures a student can only fetch their own
// transcript; admin/staff roles bypass automatically via the middleware.
transcriptsRouter.get('/:id', validateParams(paramsSchema), requireRole(...ROLE_GROUPS.ADMIN_STAFF, ...ROLE_GROUPS.TEACHING, ...ROLE_GROUPS.STUDENTS), requireOwnership(ownerLookup.transcript), ctrl.getById);
transcriptsRouter.post('/', validate(createSchema), requireRole(...ROLE_GROUPS.REGISTRY), ctrl.create);
transcriptsRouter.patch('/:id', validateParams(paramsSchema), validate(updateSchema), requireRole(...ROLE_GROUPS.REGISTRY), ctrl.update);
transcriptsRouter.delete('/:id', validateParams(paramsSchema), requireRole(...ROLE_GROUPS.SUPER_ADMIN), ctrl.remove);
