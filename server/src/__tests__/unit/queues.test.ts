/**
 * Phase 0 batch 0D — queue registry unit tests.
 *
 * Verifies the soft-skip semantics when REDIS_URL is unset: enqueue
 * returns null and logs a warning rather than throwing. This is the
 * contract every Phase 1+ service depends on so the API doesn't crash
 * in deployments where Redis isn't yet wired (e.g. pre-Railway
 * deployments, or any environment where the operator deliberately
 * disables BullMQ).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('utils/queues — soft-skip when REDIS_URL unset', () => {
  let originalRedisUrl: string | undefined;

  beforeEach(() => {
    originalRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    // Force re-import so the no-op shim path runs
    vi.resetModules();
  });

  afterEach(() => {
    if (originalRedisUrl !== undefined) {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  it('getQueue returns null when REDIS_URL is unset', async () => {
    const { getQueue, QUEUE_NAMES } = await import('../../utils/queues');
    expect(getQueue(QUEUE_NAMES.SMOKE)).toBeNull();
  });

  it('enqueue resolves to null when REDIS_URL is unset (no throw)', async () => {
    const { enqueue, QUEUE_NAMES } = await import('../../utils/queues');
    const result = await enqueue(QUEUE_NAMES.SMOKE, 'smoke-test', {
      nonce: 'test-nonce',
      enqueuedAt: new Date().toISOString(),
    });
    expect(result).toBeNull();
  });

  it('closeAllQueues is a no-op when no queues constructed', async () => {
    const { closeAllQueues } = await import('../../utils/queues');
    await expect(closeAllQueues()).resolves.toBeUndefined();
  });
});

describe('utils/queues — queue catalogue shape', () => {
  it('QUEUE_NAMES contains SMOKE', async () => {
    const { QUEUE_NAMES } = await import('../../utils/queues');
    expect(QUEUE_NAMES.SMOKE).toBe('smoke');
  });

  it('QueuePayloads SMOKE shape includes nonce + enqueuedAt', async () => {
    const { QUEUE_NAMES, enqueue } = await import('../../utils/queues');
    // Compile-time check: this would fail tsc if the payload shape drifts.
    const payload: Parameters<typeof enqueue<typeof QUEUE_NAMES.SMOKE>>[2] = {
      nonce: 'x',
      enqueuedAt: 'y',
    };
    expect(payload.nonce).toBe('x');
    expect(payload.enqueuedAt).toBe('y');
  });
});
