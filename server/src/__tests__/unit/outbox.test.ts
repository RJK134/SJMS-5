import { describe, it, expect, vi, beforeEach } from 'vitest';

import { emitOutboxEvent, OUTBOX_STATUS } from '../../utils/outbox';

const mockCreate = vi.fn();

vi.mock('../../utils/prisma', () => ({
  prisma: {
    outboxEvent: {
      get create() {
        return mockCreate;
      },
    },
  },
}));

vi.mock('../../utils/request-context', () => ({
  getRequestId: () => 'ctx-req-1',
}));

describe('utils/outbox', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ id: 'evt-1' });
  });

  it('writes an OutboxEvent row with the expected fields', async () => {
    await emitOutboxEvent({
      eventName: 'enrolment.created',
      entityType: 'Enrolment',
      entityId: 'enr-1',
      actorId: 'kc-user-1',
      payload: { id: 'enr-1', studentId: 'stu-1' },
    });
    expect(mockCreate).toHaveBeenCalledOnce();
    const args = mockCreate.mock.calls[0][0];
    expect(args.data).toMatchObject({
      eventName: 'enrolment.created',
      entityType: 'Enrolment',
      entityId: 'enr-1',
      actorId: 'kc-user-1',
      payload: { id: 'enr-1', studentId: 'stu-1' },
      requestId: 'ctx-req-1',
    });
    expect(args.data.availableAt).toBeInstanceOf(Date);
  });

  it('honours an explicit availableAt and requestId', async () => {
    const when = new Date('2026-06-01T00:00:00Z');
    await emitOutboxEvent({
      eventName: 'fee.charged',
      entityType: 'Invoice',
      entityId: 'inv-1',
      actorId: 'system',
      payload: { id: 'inv-1' },
      availableAt: when,
      requestId: 'explicit-req',
    });
    expect(mockCreate.mock.calls[0][0].data.availableAt).toBe(when);
    expect(mockCreate.mock.calls[0][0].data.requestId).toBe('explicit-req');
  });

  it('uses the passed-in transaction client when provided', async () => {
    const txMock = { outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'evt-2' }) } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await emitOutboxEvent(
      {
        eventName: 'noop.event',
        entityType: 'Noop',
        entityId: 'n-1',
        actorId: 'system',
        payload: {},
      },
      txMock as unknown as Parameters<typeof emitOutboxEvent>[1],
    );
    expect(txMock.outboxEvent.create).toHaveBeenCalledOnce();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('exposes the OUTBOX_STATUS constants', () => {
    expect(OUTBOX_STATUS.PENDING).toBe('PENDING');
    expect(OUTBOX_STATUS.IN_FLIGHT).toBe('IN_FLIGHT');
    expect(OUTBOX_STATUS.DELIVERED).toBe('DELIVERED');
    expect(OUTBOX_STATUS.FAILED).toBe('FAILED');
    expect(OUTBOX_STATUS.DISCARDED).toBe('DISCARDED');
  });
});
