# Event delivery runbook

> **Status:** Phase 0 batch 0D skeleton. Batch 0L fills in the outbox
> failure-mode procedures + replay flow.
> **Audience:** on-call operator (currently Richard; Freddie post-bus-
> factor fix).
> **Last updated:** 2026-05-18

---

## 1. What this runbook covers

The two-process event-delivery path:

```
API (Vercel)  →  Postgres OutboxEvent row   ──┐
                                              ↓
API (Vercel)  →  Redis BullMQ queue          ─┤  → Worker (Railway)  →  n8n
                                              ↓
API (Vercel)  →  Postgres AuditLog row       ─┘
```

Both the outbox and the BullMQ queues are drained by a single Node
process on the Railway long-running host. See
[`docs/architecture/outbox-worker-hosting.md`](../architecture/outbox-worker-hosting.md)
for the deploy topology.

---

## 2. Healthcheck

`GET https://<railway-worker-domain>/health` returns:

```json
{
  "status": "ok",
  "uptimeSeconds": 123,
  "lastOutboxPolledAt": "2026-05-18T22:30:00Z",
  "lastOutboxDeliveredAt": "2026-05-18T22:29:42Z",
  "pendingOutboxEvents": 3,
  "deadOutboxEvents": 0
}
```

- `lastOutboxPolledAt == null` is expected in Phase 0 (before batch 0L).
- `pendingOutboxEvents > 1000` for more than 5 minutes → alert (Phase 10).
- `deadOutboxEvents > 0` → alert (Phase 10).

---

## 3. Prometheus metrics

| Metric | Type | Source |
|---|---|---|
| `sjms_outbox_pending_total{tenant,event}` | gauge | populated by 0L worker |
| `sjms_outbox_dead_total{tenant,event}` | counter | populated by 0L worker |
| `sjms_worker_process_cpu_user_seconds_total` | counter | prom-client default |
| `sjms_worker_process_resident_memory_bytes` | gauge | prom-client default |
| BullMQ standard pack (when Phase 1+ queues land) | mixed | bullmq-prometheus |

Scrape endpoint: `GET https://<railway-worker-domain>/metrics`.

---

## 4. Failure modes (batch 0L will fill in detail)

| Failure | Detection | Response |
|---|---|---|
| Worker crashes mid-poll | Railway healthcheck fail → auto-restart | None — Railway handles it. Verify on next `/health` |
| Redis unreachable | `pendingOutboxEvents` rising without delivery | Investigate Redis status; queue drains on recovery |
| n8n unreachable | `deadOutboxEvents` rising | Investigate n8n; replay dead events (§5) |
| Postgres unreachable | Worker errors; healthcheck fail | Investigate Neon; worker resumes on recovery |
| Poison message | One event repeatedly fails until DEAD | Investigate the payload or n8n endpoint (§5) |

---

## 5. Manual replay procedure

Available after batch 0L lands.

1. List dead events:
   ```
   curl -H "Authorization: Bearer <SUPER_ADMIN_JWT>" \
     https://<api-base>/api/v1/admin/outbox?status=DEAD
   ```
2. Inspect a specific event:
   ```
   curl -H "Authorization: Bearer <SUPER_ADMIN_JWT>" \
     https://<api-base>/api/v1/admin/outbox/<id>
   ```
3. Replay:
   ```
   curl -X POST -H "Authorization: Bearer <SUPER_ADMIN_JWT>" \
     https://<api-base>/api/v1/admin/outbox/<id>/replay
   ```
   The event status flips to `PENDING`, `attempts` resets to 0, the
   worker picks it up on the next poll cycle.

---

## 6. BullMQ job replay

For Phase 1+ jobs (finance-anomaly, hesa-xml, etc.):

```
# Inspect failed jobs in a queue
curl -H "Authorization: Bearer <SUPER_ADMIN_JWT>" \
  https://<api-base>/api/v1/admin/queues/<queue-name>/failed

# Retry one failed job
curl -X POST -H "Authorization: Bearer <SUPER_ADMIN_JWT>" \
  https://<api-base>/api/v1/admin/queues/<queue-name>/jobs/<id>/retry
```

Admin queue API is sequenced to Phase 10 (alongside the observability
batch). Until then, use the Railway-side `bullmq` CLI or BullBoard for
ad-hoc inspection.

---

## 7. Rollback

To revert 0L + 0D in an emergency:

1. **Pause the Railway worker** — Railway dashboard → service → Pause.
   API keeps writing `OutboxEvent` rows but they remain `PENDING`.
2. **Revert** the `emitEvent` change set (single commit on a
   `fix/revert-0l-emit` branch) and deploy via Vercel.
3. **Drain the backlog** when the revert is debugged — restart the
   worker, OR manually replay PENDING rows via a one-off script.

`OutboxEvent` rows stay in Postgres as audit history even if the
worker is paused. No data loss.

---

## 8. References

- [`docs/architecture/outbox-worker-hosting.md`](../architecture/outbox-worker-hosting.md)
- [`docs/SJMS-5-PLAN-AMENDMENTS-2026-05-16.md`](../SJMS-5-PLAN-AMENDMENTS-2026-05-16.md) §2
- [`docs/SJMS-5-BUILD-QUEUE.md`](../SJMS-5-BUILD-QUEUE.md) Phase 0 batches 0D + 0L
