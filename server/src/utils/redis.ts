import Redis from 'ioredis';
import logger from './logger';

// ── Redis client (optional) ─────────────────────────────────────────────────
//
// The server can run without Redis. The only consumer is
// `server/src/middleware/rate-limit.ts` which uses `redis.multi()...exec()` for
// distributed rate-limit counters; that file already wraps every redis call
// in try/catch and falls back to permissive in-process defaults. The job of
// this module is therefore to:
//
//   1. Export a working ioredis client when `REDIS_URL` is set and reachable.
//   2. Export an interface-compatible no-op shim when `REDIS_URL` is unset, so
//      the server doesn't attempt connections to `redis://localhost:6379` (the
//      ioredis default) and pollute Vercel runtime logs with
//      `connect ECONNREFUSED 127.0.0.1:6379` on every request.
//   3. When `REDIS_URL` is set but unreachable (operator typo, transient
//      outage), keep the real client (so it can reconnect automatically if
//      Redis comes back), but suppress repeat error logs after the first
//      failure so the logs stay readable.
//
// The whitespace-tolerant `?.trim()` matches the same pattern PR #225 adopted
// for DEMO_MODE so an env var set as `" redis://… "` on Vercel still works.

const REDIS_URL_RAW = process.env.REDIS_URL?.trim();
const HAS_REDIS = !!REDIS_URL_RAW;

// ── No-op shim ─────────────────────────────────────────────────────────────
// Implements the surface `rate-limit.ts` uses: `.multi()` returns a chainable
// pipeline supporting `.incr() / .pttl() / .pexpire() / .decr() / .del()` and
// terminated by `.exec()`. Direct methods `.pexpire() / .decr() / .del()`
// return resolved promises with neutral defaults. `.on()` returns the shim so
// event-handler attachment is a no-op (rate-limit doesn't subscribe but other
// future callers might). Any other method access returns a Promise<0> via the
// Proxy fallback so future ioredis surface growth doesn't break the shim.
//
// IMPORTANT: the no-op shim's `.exec()` returns `null`, which `rate-limit.ts`
// already treats as "no Redis data" via `(results?.[0]?.[1] as number) ?? 1`
// — the rate limiter then returns permissive defaults (totalHits=1) so the
// request is always allowed through. This is the intended degraded mode.

interface NoOpPipeline {
  incr: (...args: unknown[]) => NoOpPipeline;
  pttl: (...args: unknown[]) => NoOpPipeline;
  pexpire: (...args: unknown[]) => NoOpPipeline;
  decr: (...args: unknown[]) => NoOpPipeline;
  del: (...args: unknown[]) => NoOpPipeline;
  exec: () => Promise<null>;
}

const noOpPipeline: NoOpPipeline = {
  incr: () => noOpPipeline,
  pttl: () => noOpPipeline,
  pexpire: () => noOpPipeline,
  decr: () => noOpPipeline,
  del: () => noOpPipeline,
  exec: async () => null,
};

const noOpRedisBase = {
  multi: () => noOpPipeline,
  pexpire: async () => 0,
  decr: async () => 0,
  del: async () => 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(this: any) {
    return this;
  },
  async connect() {},
  async disconnect() {},
  async quit() {
    return 'OK';
  },
};

// Proxy the no-op so any ioredis method (not just the ones above) returns a
// safe Promise<0> rather than throwing TypeError("redis.someNewMethod is not
// a function"). Keeps the shim forward-compatible if rate-limit.ts or any
// future caller starts using new methods.
const noOpRedis = new Proxy(noOpRedisBase, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(target: any, prop: string | symbol) {
    if (prop in target) return target[prop];
    // Do not expose `then` — a function here makes the proxy thenable and can
    // hang `await` / `Promise.resolve()` when the shim is treated as a value.
    if (prop === 'then') return undefined;
    // ioredis treats most commands as async returning a number/string.
    // Returning a resolved 0 covers the common cases without blowing up.
    return async () => 0;
  },
}) as unknown as Redis;

// ── Real client factory ────────────────────────────────────────────────────

function createRealRedisClient(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) {
        return null; // stop retrying after 5 attempts
      }
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  client.on('connect', () => logger.info('[redis] connected'));

  // Suppress error log spam. The first connection error is logged in full;
  // subsequent errors are silently swallowed so a misconfigured deployment
  // doesn't fill Vercel runtime logs with the same message on every request.
  // `retryStrategy` above already caps reconnect attempts at 5, after which
  // the client stops trying.
  let errorLogged = false;
  client.on('error', (err: Error) => {
    if (!errorLogged) {
      logger.warn(
        `[redis] connection error (${err.message}). Further [redis] error events are suppressed for this process; rate-limit will degrade to permissive defaults until Redis recovers.`,
      );
      errorLogged = true;
    }
  });

  return client;
}

// ── Resolve which instance to export ───────────────────────────────────────

let exported: Redis;
if (!HAS_REDIS) {
  logger.info(
    '[redis] REDIS_URL not set — using no-op shim. Distributed rate limiting is disabled for this process; express-rate-limit falls back to permissive defaults. Set REDIS_URL to enable.',
  );
  exported = noOpRedis;
} else {
  exported = createRealRedisClient(REDIS_URL_RAW!);
}

export const redis = exported;
export default exported;

// ── BullMQ-compatible connection factory ───────────────────────────────────
//
// BullMQ requires `maxRetriesPerRequest: null` on its Redis connection
// because internal commands BLOCK waiting for results — the
// retry-then-fail behaviour rate-limit.ts depends on would orphan
// queued jobs. We therefore expose a separate connection factory used
// by `server/src/utils/queues.ts` (API enqueue side) and
// `server/src/workers/bullmq-bootstrap.ts` (worker process). Returns
// `null` when REDIS_URL is unset — callers degrade gracefully.

let queueConnection: Redis | null | undefined;

/**
 * Lazy-construct an ioredis client tuned for BullMQ's requirements.
 * Singleton per process. Returns `null` when REDIS_URL is unset so the
 * API can soft-skip enqueue calls without crashing on a non-Redis
 * deployment (matching the no-op shim contract above).
 */
export function getQueueConnection(): Redis | null {
  if (queueConnection !== undefined) {
    return queueConnection;
  }
  if (!HAS_REDIS) {
    queueConnection = null;
    return null;
  }
  queueConnection = new Redis(REDIS_URL_RAW!, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  queueConnection.on('connect', () => logger.info('[redis:bullmq] connected'));
  let errorLogged = false;
  queueConnection.on('error', (err: Error) => {
    if (!errorLogged) {
      logger.warn(
        `[redis:bullmq] connection error (${err.message}). Further [redis:bullmq] errors are suppressed; jobs queued in-process will retry until Redis recovers.`,
      );
      errorLogged = true;
    }
  });
  return queueConnection;
}
