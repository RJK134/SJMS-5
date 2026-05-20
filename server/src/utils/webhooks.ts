import { createHmac } from 'crypto';
import logger from './logger';
import prisma from './prisma';
import { getRequestId } from './request-context';

// ── Canonical webhook payload contract ──────────────────────────────────────
// All SJMS events MUST use this shape.

/** Structured webhook payload for n8n integration. */
export interface WebhookPayload {
  /** Event name, e.g. "enrolment.created" */
  event: string;
  /** Prisma model name, e.g. "Enrolment" */
  entityType: string;
  /** Primary key of the affected entity */
  entityId: string;
  /** Keycloak user ID (sub claim) of the actor who triggered the mutation */
  actorId: string;
  /** ISO 8601 UTC timestamp — auto-generated if omitted */
  timestamp?: string;
  /** Correlation identifier propagated from the inbound HTTP request when present. */
  requestId?: string;
  /** Relevant fields only (never the full Prisma object) */
  data: Record<string, unknown>;
}

/** Resolved webhook payload — all optional fields filled in before dispatch. */
export type ResolvedWebhookPayload = Required<WebhookPayload>;

// ── Configuration ───────────────────────────────────────────────────────────
// WEBHOOK_BASE_URL is preferred; falls back to legacy WEBHOOK_URL for compat.
const WEBHOOK_BASE_URL =
  process.env.WEBHOOK_BASE_URL || process.env.WEBHOOK_URL || 'http://localhost:5678';

const MAX_RETRIES = 3;

// WEBHOOK_SECRET is read lazily so a misconfigured production deployment does
// not crash at module load (which on Vercel kills the serverless cold-start
// before any route handler runs). The secret is required only when a webhook
// is actually signed and sent — see signPayload(). Dev/test environments may
// continue to run with an unset secret (signs with an empty-string HMAC,
// matching pre-refactor behaviour); production environments without
// WEBHOOK_SECRET will throw the same error message as before, but per
// webhook attempt rather than at import.
//
// The resolved value is memoised so successive emitEvent calls do not pay
// the env-read cost; the env is not expected to change at runtime.
let cachedWebhookSecret: string | undefined;

function requireWebhookSecret(): string {
  if (cachedWebhookSecret !== undefined) return cachedWebhookSecret;
  const raw = process.env.WEBHOOK_SECRET?.trim();
  if (raw) {
    cachedWebhookSecret = raw;
    return cachedWebhookSecret;
  }
  const isDevelopmentLikeEnv =
    process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  if (isDevelopmentLikeEnv) {
    cachedWebhookSecret = '';
    return cachedWebhookSecret;
  }
  throw new Error(
    'WEBHOOK_SECRET must be configured for webhook signing outside development/test environments'
  );
}

// ── Event routing ───────────────────────────────────────────────────────────
// Every event maps to a unique n8n webhook path so that each workflow can
// listen on its own path without shared-path conflicts (resolves KI-P6-005).
// Exact event name is checked first; prefix-based fallback handles events
// that do not yet have a dedicated workflow.
const EVENT_ROUTES: Record<string, string> = {
  // ── Admissions (unique path per workflow) ──────────────────────────────
  'enquiry.created':                  '/webhook/sjms/enquiry/created',
  'application.created':              '/webhook/sjms/application/created',
  'application.updated':              '/webhook/sjms/application/updated',
  'application.status_changed':       '/webhook/sjms/application/status-changed',
  'application.offer_made':           '/webhook/sjms/offer/decision-made',
  'application.offer_conditions_met': '/webhook/sjms/application/offer-conditions-met',
  'application.firm_accepted':        '/webhook/sjms/application/firm-accepted',
  'application.withdrawn':            '/webhook/sjms/application/withdrawn',
  'application.deleted':              '/webhook/sjms/application/deleted',
  'application.converted':            '/webhook/sjms/application/converted',

  // ── Student lifecycle (created on applicant-to-student conversion) ────
  'students.created':                 '/webhook/sjms/student/created',

  // ── Enrolment ─────────────────────────────────────────────────────────
  'enrolment.created':                '/webhook/sjms/enrolment/created',
  'enrolment.updated':                '/webhook/sjms/enrolment/updated',
  'enrolment.status_changed':         '/webhook/sjms/enrolment/status-changed',
  'enrolment.withdrawn':              '/webhook/sjms/enrolment/withdrawn',

  // ── Assessment / Marks ────────────────────────────────────────────────
  'marks.submitted':                  '/webhook/sjms/marks/submitted',
  'marks.created':                    '/webhook/sjms/marks/created',
  'marks.moderated':                  '/webhook/sjms/marks/moderated',
  'marks.ratified':                   '/webhook/sjms/marks/ratified',
  'marks.released':                   '/webhook/sjms/marks/released',
  'marks.status_changed':             '/webhook/sjms/marks/status-changed',
  'marks.aggregated':                 '/webhook/sjms/marks/aggregated',
  'marks.deleted':                    '/webhook/sjms/marks/deleted',

  // ── Module results ────────────────────────────────────────────────────
  'module_results.created':           '/webhook/sjms/module-results/created',
  'module_results.updated':           '/webhook/sjms/module-results/updated',
  'module_results.status_changed':    '/webhook/sjms/module-results/status-changed',
  'module_results.ratified':          '/webhook/sjms/module-results/ratified',
  'module_results.batch_generated':   '/webhook/sjms/module-results/batch-generated',
  'module_results.deleted':           '/webhook/sjms/module-results/deleted',

  // ── Second-marking / Anonymous-marking (Workstream C3) ────────────────
  'second_marking.assigned':            '/webhook/sjms/second-marking/assigned',
  'second_marking.recorded':            '/webhook/sjms/second-marking/recorded',
  'second_marking.reconciled':          '/webhook/sjms/second-marking/reconciled',
  'second_marking.requires_third_marker': '/webhook/sjms/second-marking/requires-third-marker',
  'anonymous_marking.created':          '/webhook/sjms/anonymous-marking/created',
  'anonymous_marking.revealed':         '/webhook/sjms/anonymous-marking/revealed',

  // ── Progression / awards (Phase 17D) ──────────────────────────────────
  'progressions.created':             '/webhook/sjms/progressions/created',
  'progressions.updated':             '/webhook/sjms/progressions/updated',
  'progressions.decision_changed':    '/webhook/sjms/progressions/decision-changed',
  'progressions.decided':             '/webhook/sjms/progressions/decided',
  'progressions.deleted':             '/webhook/sjms/progressions/deleted',
  'awards.created':                   '/webhook/sjms/awards/created',
  'awards.updated':                   '/webhook/sjms/awards/updated',
  'awards.classified':                '/webhook/sjms/awards/classified',
  'awards.deleted':                   '/webhook/sjms/awards/deleted',

  // ── Transcripts (Phase 17E) ───────────────────────────────────────────
  'transcripts.created':              '/webhook/sjms/transcripts/created',
  'transcripts.updated':              '/webhook/sjms/transcripts/updated',
  'transcripts.composed':             '/webhook/sjms/transcripts/composed',
  'transcripts.deleted':              '/webhook/sjms/transcripts/deleted',

  // ── Fee assessments (Phase 18A) ───────────────────────────────────────
  'fee_assessment.created':           '/webhook/sjms/fee-assessment/created',
  'fee_assessment.updated':           '/webhook/sjms/fee-assessment/updated',
  'fee_assessment.calculated':        '/webhook/sjms/fee-assessment/calculated',

  // ── Invoices (Phase 18B) ──────────────────────────────────────────────
  'invoice.created':                  '/webhook/sjms/invoice/created',
  'invoice.updated':                  '/webhook/sjms/invoice/updated',
  'invoice.generated':                '/webhook/sjms/invoice/generated',
  'invoice.status_changed':           '/webhook/sjms/invoice/status-changed',
  'invoice.deleted':                  '/webhook/sjms/invoice/deleted',

  // ── Payments (Phase 18C) ──────────────────────────────────────────────
  'payment.created':                  '/webhook/sjms/payment/created',
  'payment.updated':                  '/webhook/sjms/payment/updated',
  'payment.allocated':                '/webhook/sjms/payment/allocated',
  'payment.status_changed':           '/webhook/sjms/payment/status-changed',
  'payment.deleted':                  '/webhook/sjms/payment/deleted',

  // ── Payment plans + instalments (Phase 18D) ──────────────────────────
  'payment_plan.created':             '/webhook/sjms/payment-plan/created',
  'payment_plan.updated':             '/webhook/sjms/payment-plan/updated',
  'payment_plan.schedule_generated':  '/webhook/sjms/payment-plan/schedule-generated',
  'payment_plan.status_changed':      '/webhook/sjms/payment-plan/status-changed',
  'payment_plan.deleted':             '/webhook/sjms/payment-plan/deleted',
  'payment_instalment.updated':       '/webhook/sjms/payment-instalment/updated',
  'payment_instalment.status_changed':'/webhook/sjms/payment-instalment/status-changed',
  'payment_instalment.paid':          '/webhook/sjms/payment-instalment/paid',
  'payment_instalment.deleted':       '/webhook/sjms/payment-instalment/deleted',

  // ── Sponsors / Bursaries / Refunds (Workstream C1) ────────────────────
  'sponsor.created':                  '/webhook/sjms/sponsor/created',
  'sponsor.updated':                  '/webhook/sjms/sponsor/updated',
  'sponsor.status_changed':           '/webhook/sjms/sponsor/status-changed',
  'sponsor.deleted':                  '/webhook/sjms/sponsor/deleted',
  'sponsor_agreement.created':        '/webhook/sjms/sponsor-agreement/created',
  'sponsor_agreement.updated':        '/webhook/sjms/sponsor-agreement/updated',
  'sponsor_agreement.status_changed': '/webhook/sjms/sponsor-agreement/status-changed',
  'sponsor_agreement.deleted':        '/webhook/sjms/sponsor-agreement/deleted',
  'sponsor_invoice.created':          '/webhook/sjms/sponsor-invoice/created',
  'sponsor_invoice.updated':          '/webhook/sjms/sponsor-invoice/updated',
  'sponsor_invoice.status_changed':   '/webhook/sjms/sponsor-invoice/status-changed',
  'sponsor_invoice.deleted':          '/webhook/sjms/sponsor-invoice/deleted',
  'bursary_fund.created':             '/webhook/sjms/bursary-fund/created',
  'bursary_fund.updated':             '/webhook/sjms/bursary-fund/updated',
  'bursary_fund.deleted':             '/webhook/sjms/bursary-fund/deleted',
  'bursary_application.created':      '/webhook/sjms/bursary-application/created',
  'bursary_application.updated':      '/webhook/sjms/bursary-application/updated',
  'bursary_application.status_changed':'/webhook/sjms/bursary-application/status-changed',
  'bursary_application.deleted':      '/webhook/sjms/bursary-application/deleted',
  'credit_note.created':              '/webhook/sjms/credit-note/created',
  'credit_note.updated':              '/webhook/sjms/credit-note/updated',
  'credit_note.deleted':              '/webhook/sjms/credit-note/deleted',
  'refund_approval.created':          '/webhook/sjms/refund-approval/created',
  'refund_approval.updated':          '/webhook/sjms/refund-approval/updated',
  'refund_approval.status_changed':   '/webhook/sjms/refund-approval/status-changed',
  'refund_approval.deleted':          '/webhook/sjms/refund-approval/deleted',
  // Phase 1D — REGISTRY proposes → FINANCE approves / rejects → FINANCE processes
  'refund_approval.proposed':         '/webhook/sjms/refund-approval/proposed',
  'refund_approval.approved':         '/webhook/sjms/refund-approval/approved',
  'refund_approval.rejected':         '/webhook/sjms/refund-approval/rejected',
  'refund_approval.processed':        '/webhook/sjms/refund-approval/processed',

  // ── Exam boards ───────────────────────────────────────────────────────
  'exam_board.scheduled':             '/webhook/sjms/exam-board/scheduled',
  'exam_board.updated':               '/webhook/sjms/exam-board/updated',
  'exam_board.status_changed':        '/webhook/sjms/exam-board/status-changed',
  'exam_board.deleted':               '/webhook/sjms/exam-board/deleted',

  // ── HESA returns (Workstream C2) ──────────────────────────────────────
  'hesa.return_created':              '/webhook/sjms/hesa/return-created',
  'hesa.return_composed':             '/webhook/sjms/hesa/return-composed',
  'hesa.return_validated':            '/webhook/sjms/hesa/return-validated',
  'hesa.return_exported':             '/webhook/sjms/hesa/return-exported',
  'hesa.snapshot_created':            '/webhook/sjms/hesa/snapshot-created',
  'hesa.notification_queued':         '/webhook/sjms/hesa/notification-queued',
  'hesa.notification_updated':        '/webhook/sjms/hesa/notification-updated',
  'hesa.notification_deleted':        '/webhook/sjms/hesa/notification-deleted',

  // ── UKVI ──────────────────────────────────────────────────────────────
  'ukvi.record_created':              '/webhook/sjms/ukvi/record-created',
  'ukvi.record_updated':              '/webhook/sjms/ukvi/record-updated',
  'ukvi.compliance_changed':          '/webhook/sjms/ukvi/compliance-changed',
  'ukvi.record_deleted':              '/webhook/sjms/ukvi/record-deleted',

  // ── Prefix-based fallback for domains without dedicated workflows ─────
  'finance':                          '/webhook/sjms/finance',
  'ec_claim':                         '/webhook/sjms/ec-claim',
  'document':                         '/webhook/sjms/document',
  'offer_condition':                  '/webhook/sjms/offer-condition',
  'module_registration':              '/webhook/sjms/module-registration',
  'support':                          '/webhook/sjms/support',
  'programme_approval':               '/webhook/sjms/programme-approval',
  'attendance':                       '/webhook/sjms/attendance',
};

function resolveWebhookPath(eventType: string): string {
  // Exact match first
  if (EVENT_ROUTES[eventType]) return EVENT_ROUTES[eventType];
  // Prefix match (e.g., 'application.created' -> 'application')
  const prefix = eventType.split('.')[0];
  if (EVENT_ROUTES[prefix]) return EVENT_ROUTES[prefix];
  // Fallback: general webhook
  return '/webhook/sjms';
}

/** HMAC-SHA256 signature of the JSON body using WEBHOOK_SECRET. */
function signPayload(body: string): string {
  return createHmac('sha256', requireWebhookSecret()).update(body).digest('hex');
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Fire-and-forget webhook event emitter.
 *
 * - Posts to WEBHOOK_BASE_URL with HMAC-SHA256 `x-webhook-signature` header
 * - Exponential-backoff retry: 3 retries (4 total attempts) with 1 s, 2 s, 4 s backoffs
 * - Logs to AuditLog on final delivery failure only (avoids success log spam)
 *
 * Accepts either:
 *   emitEvent({ event, entityType, entityId, actorId, data })  -- preferred
 *   emitEvent('event.name', { id, ... })                       -- legacy compat
 */
export function emitEvent(payload: WebhookPayload): void;
/** @deprecated Use the single WebhookPayload argument form. */
export function emitEvent(eventType: string, legacyData: unknown): void;
export function emitEvent(
  eventTypeOrPayload: string | WebhookPayload,
  legacyData?: unknown,
): void {
  let resolved: ResolvedWebhookPayload;

  if (typeof eventTypeOrPayload === 'string') {
    // Legacy two-argument form — best-effort conversion for backward compat
    const raw = (legacyData && typeof legacyData === 'object' ? legacyData : {}) as Record<string, unknown>;
    resolved = {
      event: eventTypeOrPayload,
      entityType: eventTypeOrPayload.split('.')[0],
      entityId: String(raw.id ?? 'unknown'),
      actorId: 'system',
      timestamp: new Date().toISOString(),
      requestId: getRequestId() ?? '',
      data: raw,
    };
  } else {
    resolved = {
      ...eventTypeOrPayload,
      timestamp: eventTypeOrPayload.timestamp || new Date().toISOString(),
            requestId: (eventTypeOrPayload.requestId || getRequestId()) ?? '',
    };
  }

  fireWithRetry(resolved, 0).catch((err) => {
    logger.error(`Webhook delivery failed for ${resolved.event} after ${MAX_RETRIES} retries`, {
      error: (err as Error).message,
      event: resolved.event,
      entityType: resolved.entityType,
      entityId: resolved.entityId,
      requestId: resolved.requestId,
    });
    // Persist failure to AuditLog for operational visibility
    logWebhookFailure(resolved, (err as Error).message).catch(() => {
      // Audit write must never propagate errors to the caller
    });
  });
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function fireWithRetry(
  payload: ResolvedWebhookPayload,
  attempt: number,
): Promise<void> {
  const path = resolveWebhookPath(payload.event);
  const body = JSON.stringify(payload);
  const signature = signPayload(body);

  try {
    const res = await fetch(`${WEBHOOK_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature,
                  'x-request-id': payload.requestId,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      if (attempt < MAX_RETRIES) {
        try {
          await res.body?.cancel();
        } catch {
          // Ignore body disposal errors and continue retry flow
        }
        // Exponential backoff: 2^0=1s, 2^1=2s, 2^2=4s
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        return fireWithRetry(payload, attempt + 1);
      }
      let responseText = '';
      try {
        responseText = await res.text();
      } catch {
        // Ignore body read errors
      }
      throw new Error(
        responseText
          ? `Webhook returned ${res.status}: ${res.statusText} - ${responseText}`
          : `Webhook returned ${res.status}: ${res.statusText}`,
      );
    }
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      return fireWithRetry(payload, attempt + 1);
    }
    throw err;
  }
}

/** Write a WebhookDelivery failure record to AuditLog. */
async function logWebhookFailure(
  payload: ResolvedWebhookPayload,
  errorMessage: string,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: 'WebhookDelivery',
        entityId: payload.entityId,
        action: 'CREATE',
        userId: payload.actorId !== 'system' ? payload.actorId : null,
        newData: {
          event: payload.event,
          targetEntityType: payload.entityType,
          error: errorMessage,
          failedAt: new Date().toISOString(),
          requestId: payload.requestId ?? null,
        },
      },
    });
  } catch {
    // Audit write must never throw into the calling chain
  }
}
