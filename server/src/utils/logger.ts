import winston from "winston";
import { getRequestId } from "./request-context";

const { combine, timestamp, json, printf, colorize } = winston.format;

const requestContextFormat = winston.format((info) => {
  const requestId = getRequestId();
  if (requestId && info.requestId === undefined) {
    info.requestId = requestId;
  }
  return info;
});

const devFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${timestamp} [${level}]: ${message}${metaStr}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  defaultMeta: { service: "sjms-api", version: "2.5.0" },
  transports: [
    new winston.transports.Console({
      format:
        process.env.NODE_ENV === "production"
          ? combine(timestamp(), requestContextFormat(), json())
          : combine(timestamp({ format: "HH:mm:ss" }), requestContextFormat(), colorize(), devFormat),
    }),
  ],
});

// File transports were intentionally removed — Vercel and other ephemeral-
// filesystem PaaS hosts lose log files on every restart, so they create the
// illusion of persistent logging without delivering it. Production log
// retention is the platform's responsibility (Vercel Log Drains / Datadog /
// Loki / CloudWatch); this logger emits structured JSON to stdout which all
// platform log collectors ingest natively. If a self-hosted deployment
// requires file transports, add them in a deployment-local override module
// rather than re-introducing them here.

export default logger;
