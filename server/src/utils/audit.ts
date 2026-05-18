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
    await prisma.auditLog.create({
      data: {
        entityType,
        entityId,
        action,
        userId: userId ?? null,
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
