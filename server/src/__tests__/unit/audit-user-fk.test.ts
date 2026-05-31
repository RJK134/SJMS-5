/**
 * Phase 1I — AuditLog FK hardening unit tests.
 *
 * Confirms that `logAudit` populates `audit_user_id` correctly across the
 * four flavours of free-text `userId`:
 *   - a real User.id → resolves directly
 *   - a Keycloak `sub` claim → resolves via User.keycloakId
 *   - a synthetic system actor (`system`, `system:…`) → stays null
 *   - undefined / null → stays null
 *
 * The original `userId` text is preserved verbatim in every case.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique, create } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../../utils/prisma', () => ({
  default: {
    user: { findUnique },
    auditLog: { create },
  },
}));

import { logAudit } from '../../utils/audit';

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: 'al-1' });
});

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

describe('logAudit — Phase 1I audit_user_id resolution', () => {
  it('resolves a User.id directly to auditUserId', async () => {
    findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'user-real') return { id: 'user-real' };
      return null;
    });

    await logAudit('Invoice', 'inv-1', 'CREATE', 'user-real', null, {}, fakeReq);

    const data = create.mock.calls[0][0].data;
    expect(data.userId).toBe('user-real');
    expect(data.auditUserId).toBe('user-real');
  });

  it('resolves a Keycloak sub via User.keycloakId when the direct id lookup fails', async () => {
    findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'kc-sub-123') return null;
      if (where.keycloakId === 'kc-sub-123') return { id: 'user-mapped' };
      return null;
    });

    await logAudit('Invoice', 'inv-1', 'CREATE', 'kc-sub-123', null, {}, fakeReq);

    const data = create.mock.calls[0][0].data;
    expect(data.userId).toBe('kc-sub-123'); // preserved verbatim
    expect(data.auditUserId).toBe('user-mapped');
  });

  it('leaves auditUserId null for synthetic system actors', async () => {
    await logAudit('LedgerAnomalyScan', 'ls-1', 'VIEW', 'system:ledger-anomaly-cron', null, {});
    await logAudit('Invoice', 'inv-1', 'CREATE', 'system', null, {});

    for (const c of create.mock.calls) {
      expect(c[0].data.auditUserId).toBeNull();
      expect(typeof c[0].data.userId).toBe('string');
      expect(c[0].data.userId.startsWith('system')).toBe(true);
    }
    // No User lookups are issued for system actors.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('leaves auditUserId null when userId is undefined', async () => {
    await logAudit('Invoice', 'inv-1', 'CREATE', undefined, null, {});
    const data = create.mock.calls[0][0].data;
    expect(data.userId).toBeNull();
    expect(data.auditUserId).toBeNull();
  });

  it('returns null and still writes the audit row when the User lookup throws', async () => {
    findUnique.mockRejectedValue(new Error('db blip'));
    await logAudit('Invoice', 'inv-1', 'CREATE', 'user-real', null, {}, fakeReq);
    const data = create.mock.calls[0][0].data;
    expect(data.userId).toBe('user-real');
    expect(data.auditUserId).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the audit write itself fails', async () => {
    findUnique.mockResolvedValue({ id: 'user-real' });
    create.mockRejectedValue(new Error('audit write down'));
    // logAudit catches and warns; the call itself must not reject.
    await expect(
      logAudit('Invoice', 'inv-1', 'CREATE', 'user-real', null, {}, fakeReq),
    ).resolves.toBeUndefined();
  });
});
