/**
 * SJMS dataset import worker (Phase D8).
 *
 * Wires the standalone `scripts/import-sjms-dataset.mjs` script to a weekly
 * BullMQ cron. The schedule fires Sundays 09:00 Europe/Zurich, matching the
 * Maieus2 datalake-importer cadence — both downstream consumers pull from
 * the same upstream `gdrive5tb` snapshot that the Workhorse cron refreshes
 * at Sun 06:00 Europe/Zurich. The three-hour offset is defensive headroom
 * for the upstream rclone sync; do not tighten without checking the
 * Workhorse cron at `RJK134/Macbook`.
 *
 * Why a subprocess instead of an in-process import?
 *   1. The importer is a `.mjs` ESM script and the server compiles to
 *      CommonJS. Spawning keeps the module-system boundary clean.
 *   2. The script owns its own Prisma lifecycle, dotenv loading, and CLI
 *      flag parsing — re-using it as a subprocess matches the repo
 *      convention of "scripts/ owns one-shots."
 *   3. Mirrors the proven `apps/api/src/datalake-scheduler.ts` pattern in
 *      sibling repo Maieus2, which has shipped this shape for two phases.
 *
 * Gating: the scheduler only registers when
 * `SJMS_ENABLE_DATASET_SCHEDULER=true`. Dev, test, and Vercel function cold
 * starts therefore never connect to Redis or attempt to enqueue cron rows.
 * The `pnpm worker` long-running process is the only place this fires —
 * worker hosts on Railway / Render / Fly / an always-on local VM are the
 * intended targets (see `evidence/phase-0/0d-bullmq-worker.md`).
 *
 * Source selection:
 *   - `SJMS_DATASET_SOURCE` env var, default `./output/latest`. Operators
 *     point this at a local snapshot directory or an rclone remote URL
 *     (`gdrive5tb:sjms-5-dataset/latest/`) — the importer resolves both.
 *
 * Operator-on-demand: `triggerImportNow()` enqueues a one-off job that the
 * same worker picks up identically to the cron-scheduled job. Health
 * surfaces read `getLastDatasetImportRun()` for the most recent outcome
 * (run timing, exit code, trigger kind). One scheduler per worker process —
 * the registration in `workers/index.ts` is idempotent and respects the env
 * gate.
 */

import { spawn, type SpawnOptions } from 'node:child_process';
import { resolve } from 'node:path';

import logger from '../utils/logger';
import { createWorker, getQueue } from '../utils/queue';

/** Queue carrying both the weekly cron job and any operator-triggered one-offs. */
export const SJMS_DATASET_QUEUE_NAME = 'sjms-dataset-import';
/** Job name attached to the weekly cron schedule. */
export const SJMS_DATASET_JOB_NAME = 'weekly-dataset-import';
/** Job name attached to operator-triggered one-off runs. */
export const SJMS_DATASET_JOB_NAME_MANUAL = 'manual-dataset-import';
/**
 * Sun 09:00 Europe/Zurich — same slot as Maieus2's datalake-importer. Both
 * consumers pull from the same `gdrive5tb` lake refreshed by the upstream
 * Workhorse snapshot at Sun 06:00 Europe/Zurich.
 */
export const SJMS_DATASET_CRON_PATTERN = '0 9 * * 0';
export const SJMS_DATASET_CRON_TIMEZONE = 'Europe/Zurich';
/** Env-gate the registration so non-worker processes never touch Redis. */
export const SJMS_DATASET_ENABLE_ENV = 'SJMS_ENABLE_DATASET_SCHEDULER' as const;
/** Env-configurable source path, defaults to the local "latest" snapshot. */
export const SJMS_DATASET_SOURCE_ENV = 'SJMS_DATASET_SOURCE' as const;
export const SJMS_DATASET_DEFAULT_SOURCE = './output/latest' as const;

export interface DatasetImportLastRun {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'ok' | 'error';
  /** Exit code from the spawned `node scripts/import-sjms-dataset.mjs` call. */
  exitCode: number;
  /** `--source` value passed to the importer (effective at run time). */
  source: string;
  /** Error message captured when the subprocess could not be spawned. */
  errorMessage?: string;
  /** `cron` for the weekly Sunday job, `manual` for an operator one-off. */
  trigger: 'cron' | 'manual';
}

let lastRun: DatasetImportLastRun | null = null;

/**
 * Last-run accessor for `/health`-style surfaces and operator dashboards.
 *
 * Returns `null` until the worker has processed at least one job. The shape
 * mirrors `DatalakeLastRun` from the Maieus2 sibling so dashboards can
 * normalise both sources with a single adapter.
 */
export function getLastDatasetImportRun(): DatasetImportLastRun | null {
  return lastRun;
}

/** Test-only hook — reset the in-process cache between cases. */
export function __resetLastDatasetImportRunForTests(): void {
  lastRun = null;
}

function resolveSource(): string {
  return process.env[SJMS_DATASET_SOURCE_ENV]?.trim() || SJMS_DATASET_DEFAULT_SOURCE;
}

function defaultProjectRoot(): string {
  // server/src/workers/sjms-dataset-import.worker.ts → ../../../ = repo root
  return resolve(__dirname, '..', '..', '..');
}

export interface RunImportOptions {
  /** Override the source path (defaults to env var lookup). */
  source?: string;
  /** Override the spawn impl — test seam. */
  spawnImpl?: typeof spawn;
  /** Override the cwd of the subprocess. Defaults to the inferred repo root. */
  projectRoot?: string;
}

/**
 * Spawn the importer once. Resolves to the subprocess exit code. Stdout /
 * stderr inherit the parent's streams so the worker host's log collector
 * captures the importer's `[import-sjms-dataset] ...` lines alongside the
 * worker process logs.
 *
 * Exported for direct testability: tests pass a fake `spawnImpl` to avoid
 * launching a real Node subprocess.
 */
export function runDatasetImportOnce(opts: RunImportOptions = {}): Promise<number> {
  const spawnFn = opts.spawnImpl ?? spawn;
  const source = opts.source ?? resolveSource();
  const projectRoot = opts.projectRoot ?? defaultProjectRoot();
  const args = ['scripts/import-sjms-dataset.mjs', '--source', source, '--persist'];
  const options: SpawnOptions = {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  };

  return new Promise((resolveExit, reject) => {
    const child = spawnFn('node', args, options);
    child.on('error', reject);
    child.on('exit', (code) => resolveExit(code ?? 1));
  });
}

/**
 * Register the BullMQ worker + cron schedule for the SJMS dataset importer.
 *
 * No-op (and logs a single info line) when `SJMS_ENABLE_DATASET_SCHEDULER`
 * is not exactly `"true"`. Idempotent within a process — the BullMQ
 * `upsertJobScheduler` call handles repeat invocations safely, but the
 * worker entry-point should only call this once.
 *
 * Called from `server/src/workers/index.ts::main()` alongside the other
 * `register*Worker()` entries.
 */
export function registerSjmsDatasetImportWorker(): void {
  const enabled = process.env[SJMS_DATASET_ENABLE_ENV]?.trim().toLowerCase() === 'true';
  if (!enabled) {
    logger.info(
      `[sjms-dataset-import.worker] disabled — set ${SJMS_DATASET_ENABLE_ENV}=true to enable the weekly cron`,
    );
    return;
  }

  const queue = getQueue(SJMS_DATASET_QUEUE_NAME);
  // Wire the weekly cron. `upsertJobScheduler` is idempotent — repeat calls
  // replace the existing schedule rather than creating duplicates.
  void queue.upsertJobScheduler(
    `${SJMS_DATASET_JOB_NAME}-weekly`,
    { pattern: SJMS_DATASET_CRON_PATTERN, tz: SJMS_DATASET_CRON_TIMEZONE },
    { name: SJMS_DATASET_JOB_NAME, data: {} },
  );

  createWorker(SJMS_DATASET_QUEUE_NAME, async (job) => {
    const startedAt = new Date();
    const trigger: 'cron' | 'manual' =
      job.name === SJMS_DATASET_JOB_NAME_MANUAL ? 'manual' : 'cron';
    const source = resolveSource();
    try {
      const exitCode = await runDatasetImportOnce({ source });
      const completedAt = new Date();
      lastRun = {
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        status: exitCode === 0 ? 'ok' : 'error',
        exitCode,
        source,
        trigger,
      };
      if (exitCode !== 0) {
        // Surface non-zero exits as worker errors so BullMQ's retry policy
        // applies (the queue's default attempts/backoff live in
        // utils/queue.ts::DEFAULT_JOB_OPTIONS).
        throw new Error(
          `[sjms-dataset-import] importer subprocess exited with code ${exitCode}`,
        );
      }
      return { ok: true, source };
    } catch (err) {
      const completedAt = new Date();
      if (lastRun?.startedAt !== startedAt.toISOString()) {
        lastRun = {
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
          status: 'error',
          exitCode: -1,
          source,
          errorMessage: err instanceof Error ? err.message : String(err),
          trigger,
        };
      }
      throw err;
    }
  });

  logger.info(
    `[sjms-dataset-import.worker] registered (cron="${SJMS_DATASET_CRON_PATTERN}" tz=${SJMS_DATASET_CRON_TIMEZONE} source=${resolveSource()})`,
  );
}

/**
 * Enqueue a one-off manual import. Used by operator endpoints and ad-hoc
 * CLI triggers. Returns the BullMQ job id (or `'unknown'` when BullMQ does
 * not assign one — should not happen in practice).
 *
 * Throws when `REDIS_URL` is unset, matching the rest of the queue surface.
 */
export async function triggerImportNow(): Promise<string> {
  const queue = getQueue(SJMS_DATASET_QUEUE_NAME);
  const job = await queue.add(SJMS_DATASET_JOB_NAME_MANUAL, { manual: true });
  return job.id ?? 'unknown';
}
