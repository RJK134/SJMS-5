import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

describe('utils/queue', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.REDIS_URL = ORIGINAL_REDIS_URL;
  });

  it('exports the OUTBOX_EVENTS queue name', async () => {
    delete process.env.REDIS_URL;
    const mod = await import('../../utils/queue');
    expect(mod.QUEUE_NAMES.OUTBOX_EVENTS).toBe('outbox-events');
  });

  it('exports sensible DEFAULT_JOB_OPTIONS (attempts, backoff, retention)', async () => {
    delete process.env.REDIS_URL;
    const { DEFAULT_JOB_OPTIONS } = await import('../../utils/queue');
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(5);
    expect(DEFAULT_JOB_OPTIONS.backoff).toMatchObject({
      type: 'exponential',
      delay: 60_000,
    });
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toBeDefined();
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toBeDefined();
  });

  it('getQueue throws a clear error when REDIS_URL is unset', async () => {
    delete process.env.REDIS_URL;
    const { getQueue } = await import('../../utils/queue');
    expect(() => getQueue('any')).toThrow(/BullMQ requires REDIS_URL/);
  });

  it('createWorker throws a clear error when REDIS_URL is unset', async () => {
    delete process.env.REDIS_URL;
    const { createWorker } = await import('../../utils/queue');
    expect(() => createWorker('any', async () => {})).toThrow(/BullMQ requires REDIS_URL/);
  });

  it('getQueueEvents throws a clear error when REDIS_URL is unset', async () => {
    delete process.env.REDIS_URL;
    const { getQueueEvents } = await import('../../utils/queue');
    expect(() => getQueueEvents('any')).toThrow(/BullMQ requires REDIS_URL/);
  });

  it('closeAllWorkers / closeAllQueues are safe to call when no workers exist', async () => {
    delete process.env.REDIS_URL;
    const { closeAllWorkers, closeAllQueues } = await import('../../utils/queue');
    await expect(closeAllWorkers()).resolves.toBeUndefined();
    await expect(closeAllQueues()).resolves.toBeUndefined();
  });
});
