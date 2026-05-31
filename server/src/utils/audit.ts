import type { Prisma } from '@prisma/client';
import prisma from './prisma';
import type { Request } from 'express';
import { getRequestId } from './request-context';
import logger from './logger';

function withAuditMetadata(
  data: unknown,
  requestId?: string,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (data == null) return undefined;

  const serialised = JSON.parse(JSON.stringify(data)) as unknown;
  if (!requestId) return serialised as Prisma.InputJsonValue;

  if (serialised && typeof serialised === 'object' && !Array.isArray(serialised)) {
    return {
      ...(serialised as Record<string, unknown>),
      _meta: { requestId },
    };
  }

  return {
    value: serialised,
    _meta: { requestId },
  } as Prisma.InputJsonValue;
}

/**
 * Phase 1I — resolve a free-text `userId` to a real `User.id` for the
 * `audit_user_id` FK column.
 *
 * The free-text input is one of:
 *   - a real `User.id` (cuid) — matched directly
 *   - a Keycloak `sub` claim — matched via `User.keycloakId`
 *   - a synthetic system actor (`system`, `system:ledger-anomaly-cron`,
 *     `system:payment-instalment-cron`, …) — left unresolved
 *   - null / undefined — left unresolved
 *
 * Returns `null` when no User row matches, so the FK stays nullable for
 * system actors. The lookup is best-effort: any error is swallowed so an
 * audit write never fails on account of resolution. The original
 * `userId` text is preserved verbatim in either case.
 */
async function resolveAuditUserId(userId: string | undefined): Promise<string | null> {
  if (!userId || userId.startsWith('system')) return null;
  try {
    const direct = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (direct) return direct.id;
    const byKeycloak = await prisma.user.findUnique({
      where: { keycloakId: userId },
      select: { id: true },
    });
    return byKeycloak?.id ?? null;
  } catch {
    return null;
  }
}

export async function logAudit(
  entityType: string,
  entityId: string,
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'VIEW' | 'EXPORT',
  userId: string | undefined,
  previousData: unknown | null,
  newData: unknown | null,
  req?: Request,
): Promise<void> {
  try {
    const requestId = req?.requestId ?? getRequestId();
    // Capture every realm role rather than just the first — a user with
    // multiple roles otherwise leaves an incomplete audit trail. Joined
    // with commas so the column type (string) does not need to change.
    const roles = (req?.user as { realm_access?: { roles?: string[] } } | undefined)?.realm_access?.roles;
    const userRole = Array.isArray(roles) && roles.length > 0 ? roles.join(',') : null;
    const auditUserId = await resolveAuditUserId(userId);
    await prisma.auditLog.create({
      data: {
        entityType,
        entityId,
        action,
        userId: userId ?? null,
        auditUserId,
        userRole,
        ipAddress: req?.ip ?? null,
        userAgent: req?.get('user-agent') ?? null,
        previousData: withAuditMetadata(previousData, requestId),
        newData: withAuditMetadata(newData, requestId),
      },
    });
  } catch (err) {
    // Audit logging must never break the main operation, but a silent
    // catch leaves operators blind to audit-trail gaps. Log at WARN so
    // platform log collectors and any alerting on `audit_log_failures`
    // pick this up, then continue.
    logger.warn('audit log write failed', {
      entityType,
      entityId,
      action,
      userId: userId ?? null,
      error: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : undefined,
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}
