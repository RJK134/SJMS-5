import { describe, it, expect, vi } from "vitest";

import { updateWithVersion } from "../../utils/optimistic-lock";
import { OptimisticLockError } from "../../utils/errors";

function makeDelegate(updateCount: number, returnedRow: unknown = null) {
  return {
    updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
    findUniqueOrThrow: vi.fn().mockResolvedValue(returnedRow ?? { id: "x", version: 2 }),
  };
}

describe("updateWithVersion", () => {
  it("commits when version matches and returns the freshly-read row", async () => {
    const delegate = makeDelegate(1, { id: "i-1", version: 5 });
    const result = await updateWithVersion(
      delegate,
      "Invoice",
      "i-1",
      4,
      { status: "PAID" }
    );

    expect(delegate.updateMany).toHaveBeenCalledOnce();
    const args = delegate.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: "i-1", version: 4, deletedAt: null });
    expect(args.data).toEqual({
      status: "PAID",
      version: { increment: 1 },
    });
    expect(delegate.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "i-1" } });
    expect(result).toEqual({ id: "i-1", version: 5 });
  });

  it("throws OptimisticLockError when no row matches (someone else committed)", async () => {
    const delegate = makeDelegate(0);
    await expect(
      updateWithVersion(delegate, "Invoice", "i-1", 4, { status: "PAID" })
    ).rejects.toBeInstanceOf(OptimisticLockError);
    // findUniqueOrThrow is NOT called on the lock-failed path.
    expect(delegate.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("carries entityType / id / expectedVersion on the thrown error", async () => {
    const delegate = makeDelegate(0);
    try {
      await updateWithVersion(delegate, "Payment", "p-99", 7, { allocatedAt: new Date() });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OptimisticLockError);
      const lockErr = err as OptimisticLockError;
      expect(lockErr.entityType).toBe("Payment");
      expect(lockErr.entityId).toBe("p-99");
      expect(lockErr.expectedVersion).toBe(7);
      expect(lockErr.statusCode).toBe(409);
      expect(lockErr.code).toBe("OPTIMISTIC_LOCK_CONFLICT");
      expect(lockErr.message).toMatch(/Payment:p-99 was modified by another process/);
    }
  });

  it("omits deletedAt from the where clause when softDelete: false", async () => {
    const delegate = makeDelegate(1, { id: "x", version: 2 });
    await updateWithVersion(
      delegate,
      "AuditLog",
      "x",
      1,
      { description: "..." },
      { softDelete: false }
    );

    const args = delegate.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: "x", version: 1 });
    expect(args.where).not.toHaveProperty("deletedAt");
  });

  it("treats undefined softDelete as true (the default for the 7 1H models)", async () => {
    const delegate = makeDelegate(1);
    await updateWithVersion(delegate, "Invoice", "i-1", 1, {});
    expect(delegate.updateMany.mock.calls[0][0].where.deletedAt).toBeNull();
  });

  it("preserves the caller's data fields and bumps version atomically", async () => {
    const delegate = makeDelegate(1, { id: "a-1", version: 3 });
    await updateWithVersion(delegate, "AssessmentAttempt", "a-1", 2, {
      moderatedMark: "65.5",
      moderatedBy: "kc-user-1",
      moderatedDate: new Date("2026-05-19T00:00:00Z"),
      status: "MODERATED",
    });
    const data = delegate.updateMany.mock.calls[0][0].data;
    expect(data.moderatedMark).toBe("65.5");
    expect(data.moderatedBy).toBe("kc-user-1");
    expect(data.status).toBe("MODERATED");
    expect(data.version).toEqual({ increment: 1 });
  });
});

describe("OptimisticLockError", () => {
  it("composes a readable message and HTTP 409", () => {
    const err = new OptimisticLockError("Enrolment", "enr-1", 3);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("OPTIMISTIC_LOCK_CONFLICT");
    expect(err.message).toContain("Enrolment:enr-1");
    expect(err.message).toContain("expected version 3");
    expect(err.message).toContain("Refetch and retry");
  });

  it("preserves the prototype chain for instanceof checks", () => {
    const err = new OptimisticLockError("Invoice", "i-1", 1);
    expect(err).toBeInstanceOf(OptimisticLockError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("Error");
  });
});
