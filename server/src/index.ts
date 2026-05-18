// Production deploy (Vercel + Neon): DATABASE_URL points at Neon (pooled), CORS_ORIGIN configured per Vercel environment.
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { errorHandler } from "./middleware/error-handler";
import { apiLimiter, authLimiter, metricsLimiter } from "./middleware/rate-limit";
import { requestId } from "./middleware/request-id";
import { authenticateJWT, requireRole } from "./middleware/auth";
import { ROLE_GROUPS } from "./constants/roles";
import { apiV1Router } from "./api";
import { diagnosticsRouter } from "./api/diagnostics/diagnostics.router";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./utils/openapi";
import logger from "./utils/logger";
import { register, httpRequestDuration, httpRequestTotal } from "./utils/metrics";
import prisma from "./utils/prisma";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// ── Trust proxy ─────────────────────────────────────────────────────────
// Vercel (and every other reverse-proxy front end we care about — Cloudflare,
// nginx, an AWS ALB) terminates TLS and forwards the original client address
// via X-Forwarded-For. Without `trust proxy = 1` Express's req.ip falls back
// to the proxy's address and `express-rate-limit` raises
// `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` because it sees a forwarded header it
// does not trust.
//
// SECURITY: enabling `trust proxy` on a server with NO upstream reverse
// proxy lets any client spoof X-Forwarded-For and bypass IP-based rate
// limiting / logging. The setting is therefore gated on either:
//   - NODE_ENV === 'production' (Vercel, the canonical proxied target), OR
//   - TRUST_PROXY === 'true' (explicit opt-in for any other proxied env)
// In dev or any direct-internet deployment neither flag is set, so
// `req.ip` falls back to the socket address and spoofing is impossible.
//
// `1` means "trust the first proxy hop", which is exactly Vercel's edge
// topology (and the standard for any single-proxy PaaS). Set BEFORE the
// rate-limit middleware below so the limiter reads the correct client IP
// from boot. Bump to `2` if a second proxy (e.g. Cloudflare in front of
// Vercel) is ever introduced.
const TRUST_PROXY_ENABLED =
  process.env.NODE_ENV === "production" || process.env.TRUST_PROXY === "true";
if (TRUST_PROXY_ENABLED) {
  app.set("trust proxy", 1);
}

// ── Liveness probe ────────────────────────────────────────────────────────
// Top-level /health endpoint mounted BEFORE any middleware that could block
// it (helmet/cors/rate-limit/auth). Returns { status: "ok" } unconditionally
// — Vercel and other platform health probes hit this to confirm the server
// process is up and responding. Distinct from /api/health below, which adds
// a database connectivity check and is the operator-facing readiness probe.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── Core middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(requestId);
// CORS — never reflect arbitrary origins (CodeQL js/cors-permissive-configuration).
// Production: explicit allow-list from CORS_ORIGIN env var (comma-separated).
// Non-production: explicit dev allow-list (Vite dev server, plus optional
// override via CORS_ORIGIN for local tunnels).
const DEV_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3001",
];
const corsOrigins =
  process.env.NODE_ENV === "production"
    ? (process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean) ?? [])
    : [
        ...DEV_CORS_ORIGINS,
        ...(process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean) ?? []),
      ];
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
    exposedHeaders: ["x-request-id"],
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
// Morgan token + format that carries the request id alongside the HTTP line so
// Winston transport and Morgan share one correlation value per request.
morgan.token("reqid", (req) => (req as unknown as { requestId?: string }).requestId ?? "-");
app.use(
  morgan(':method :url :status :res[content-length] - :response-time ms reqid=:reqid', {
    stream: { write: (msg: string) => logger.info(msg.trim()) },
  })
);

// ── Prometheus metrics ──────────────────────────────────────────────────
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route?.path ?? req.path;
    end({ method: req.method, route, status_code: res.statusCode });
    httpRequestTotal.inc({ method: req.method, route, status_code: res.statusCode });
  });
  next();
});

// /metrics — Prometheus scrape endpoint. Must be authenticated in production
// because it leaks internal route timings, request volumes, and error rates.
// In production it requires SUPER_ADMIN; outside production it is open so
// local Prometheus stacks and developers can scrape without a token. The
// authenticateJWT middleware also accepts the internal service key, allowing
// a Prometheus scraper on the internal network to authenticate without a
// Keycloak login.
if (process.env.NODE_ENV === 'production') {
  app.get(
    '/metrics',
    metricsLimiter,
    authenticateJWT,
    requireRole(...ROLE_GROUPS.SUPER_ADMIN),
    async (_req, res) => {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    },
  );
} else {
  app.get('/metrics', metricsLimiter, async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });
}

// ── Rate limiting ────────────────────────────────────────────────────────
app.use('/api', apiLimiter);
app.use('/api/v1/auth', authLimiter);

// ── API Documentation (Swagger UI) ──────────────────────────────────────
// Swagger UI and the raw OpenAPI spec leak the entire API surface — every
// route path, schema shape, and error code. In production both are gated
// behind SUPER_ADMIN so unauthenticated callers cannot enumerate the API.
// Outside production they remain open so developers can browse the spec
// without a token.
if (process.env.NODE_ENV === 'production') {
  app.get(
    '/api/docs/spec',
    authenticateJWT,
    requireRole(...ROLE_GROUPS.SUPER_ADMIN),
    (_req, res) => res.json(openApiSpec),
  );
  app.use(
    '/api/docs',
    authenticateJWT,
    requireRole(...ROLE_GROUPS.SUPER_ADMIN),
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, { customSiteTitle: 'SJMS 2.5 API Documentation' }),
  );
} else {
  app.get('/api/docs/spec', (_req, res) => res.json(openApiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'SJMS 2.5 API Documentation',
  }));
}

// ── Health check (with DB) ──────────────────────────────────────────────
// Operator-facing readiness probe: confirms the database is reachable and
// returns { status: "degraded" } with a 503 when it isn't. The simpler
// liveness probe lives at top-level `/health` above.
app.get("/api/health", async (_req, res) => {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    checks.database = "connected";
  } catch {
    checks.database = "unavailable";
    healthy = false;
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    version: "2.5.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    checks,
  });
});

// ── Temporary diagnostic endpoint (read-only, no JWT required) ──────────
// Mounted BEFORE apiV1Router so it is not subject to the global
// authenticateJWT middleware. Protected by X-Diagnostic-Key header when
// the DIAGNOSTIC_KEY env var is set. Remove once investigation is complete.
app.use("/api/v1/diagnostics", diagnosticsRouter);

// ── API v1 router mount (37 domain modules) ────────────────────────────
app.use("/api/v1", apiV1Router);

// ── Global error handler (must be last) ─────────────────────────────────
app.use(errorHandler);

// ── Start server (direct execution only) ────────────────────────────────
// Bind a long-running HTTP listener on PORT ONLY when this module is the
// program entry (npm start / npm run dev / `node dist/index.js`, plus the
// Dockerfile CMD and `scripts/deploy-init.ts` chain). When the module is
// imported by another runtime — specifically the Vercel serverless
// function at `server/api/index.ts` — `require.main !== module` and the
// listener block is skipped. Vercel invokes the exported `app` handler
// per-request; opening a TCP listener at function cold-start would either
// fail silently or hold the function open past its invocation window,
// neither of which is acceptable in a serverless deployment.
//
// SIGTERM/SIGINT handlers are also gated here — Vercel terminates the
// runtime through its own lifecycle and our signal handlers would never
// fire there, but registering them at import time would still leak a
// process-level listener on every cold start.
if (require.main === module) {
  const server = app.listen(PORT, () => {
    logger.info(`SJMS 2.5 API server running on port ${PORT}`);
    logger.info(`Liveness:  http://localhost:${PORT}/health`);
    logger.info(`Readiness: http://localhost:${PORT}/api/health`);
    logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);

    // DEMO_MODE banner — printed once at boot whenever the public-demo
    // bypass is active (see server/src/middleware/auth.ts). Surfaces the
    // unsafe state in the Vercel Runtime Logs so an operator who has
    // left the env var on by accident notices immediately. The check
    // mirrors the whitespace-tolerant, case-insensitive guard used by
    // `authenticateJWT` so a `True` / `TRUE` / `" true "` env var value
    // still trips the banner — otherwise the bypass would silently
    // activate without the operator-facing warning Bugbot flagged.
    if (process.env.DEMO_MODE?.trim().toLowerCase() === "true") {
      logger.warn(
        "[DEMO_MODE] Authentication bypass enabled - DO NOT USE IN PRODUCTION WITH REAL DATA",
      );
    }
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const gracefulShutdown = (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

export default app;
