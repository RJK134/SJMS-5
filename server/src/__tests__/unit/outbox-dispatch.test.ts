import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { dispatchOutboxRow, resolveWebhookPath, signPayload } from '../../utils/outbox-dispatch';

const ORIGINAL_WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL;
const ORIGINAL_WEBHOOK_URL = process.env.WEBHOOK_URL;
const ORIGINAL_WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

function fakeRow(overrides: Partial<Parameters<typeof dispatchOutboxRow>[0]> = {}) {
  return {
    id: 'evt-1',
    eventName: 'enrolment.created',
    entityType: 'Enrolment',
    entityId: 'enr-1',
    actorId: 'kc-user-1',
    payload: { id: 'enr-1', programmeId: 'prog-1' },
    requestId: 'req-1',
    status: 'IN_FLIGHT',
    attempts: 0,
    lastAttemptAt: new Date('2026-05-19T00:00:00Z'),
    deliveredAt: null,
    errorMessage: null,
    availableAt: new Date('2026-05-19T00:00:00Z'),
    createdAt: new Date('2026-05-19T00:00:00Z'),
    updatedAt: new Date('2026-05-19T00:00:00Z'),
    createdBy: null,
    updatedBy: null,
    ...overrides,
  } as Parameters<typeof dispatchOutboxRow>[0];
}

describe('resolveWebhookPath', () => {
  it('converts snake_case event names to kebab-case URL segments', () => {
    expect(resolveWebhookPath('enrolment.created')).toBe('/webhook/sjms/enrolment/created');
    expect(resolveWebhookPath('module_results.batch_generated')).toBe('/webhook/sjms/module-results/batch-generated');
    expect(resolveWebhookPath('payment_instalment.paid')).toBe('/webhook/sjms/payment-instalment/paid');
  });

  it('handles events with no action segment', () => {
    expect(resolveWebhookPath('finance')).toBe('/webhook/sjms/finance');
  });
});

describe('signPayload', () => {
  beforeEach(() => {
    delete process.env.WEBHOOK_SECRET;
  });
  afterEach(() => {
    process.env.WEBHOOK_SECRET = ORIGINAL_WEBHOOK_SECRET;
  });

  it('returns the empty string when WEBHOOK_SECRET is unset', async () => {
    delete process.env.WEBHOOK_SECRET;
    vi.resetModules();
    const { signPayload: fresh } = await import('../../utils/outbox-dispatch');
    expect(fresh('hello')).toBe('');
  });

  it('returns a 64-char hex HMAC-SHA256 when WEBHOOK_SECRET is set', async () => {
    process.env.WEBHOOK_SECRET = 'test-secret';
    vi.resetModules();
    const { signPayload: fresh } = await import('../../utils/outbox-dispatch');
    const sig = fresh('hello');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('dispatchOutboxRow', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    if (ORIGINAL_WEBHOOK_BASE_URL === undefined) delete process.env.WEBHOOK_BASE_URL;
    else process.env.WEBHOOK_BASE_URL = ORIGINAL_WEBHOOK_BASE_URL;
    if (ORIGINAL_WEBHOOK_URL === undefined) delete process.env.WEBHOOK_URL;
    else process.env.WEBHOOK_URL = ORIGINAL_WEBHOOK_URL;
  });

  it('POSTs to the resolved webhook URL with the structured payload', async () => {
    fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));
    await dispatchOutboxRow(fakeRow());
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/webhook/sjms/enrolment/created');
    expect(init?.method).toBe('POST');
    const body = JSON.parse((init?.body as string) ?? '{}');
    expect(body).toMatchObject({
      event: 'enrolment.created',
      entityType: 'Enrolment',
      entityId: 'enr-1',
      actorId: 'kc-user-1',
      data: { id: 'enr-1', programmeId: 'prog-1' },
    });
  });

  it('includes x-event-id and x-request-id headers', async () => {
    fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));
    await dispatchOutboxRow(fakeRow({ id: 'evt-99', requestId: 'req-42' }));
    const init = fetchSpy.mock.calls[0][1];
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-event-id']).toBe('evt-99');
    expect(headers['x-request-id']).toBe('req-42');
  });

  it('throws on non-2xx responses', async () => {
    fetchSpy.mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(dispatchOutboxRow(fakeRow())).rejects.toThrow(/returned 404/);
  });

  it('throws on 5xx responses (caller retries)', async () => {
    fetchSpy.mockResolvedValue(new Response('boom', { status: 503 }));
    await expect(dispatchOutboxRow(fakeRow())).rejects.toThrow(/returned 503/);
  });
});
