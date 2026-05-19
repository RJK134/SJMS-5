import type { ChildProcess, spawn as SpawnFn } from 'node:child_process';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  SJMS_DATASET_CRON_PATTERN,
  SJMS_DATASET_CRON_TIMEZONE,
  SJMS_DATASET_DEFAULT_SOURCE,
  SJMS_DATASET_ENABLE_ENV,
  SJMS_DATASET_JOB_NAME,
  SJMS_DATASET_JOB_NAME_MANUAL,
  SJMS_DATASET_QUEUE_NAME,
  SJMS_DATASET_SOURCE_ENV,
  __resetLastDatasetImportRunForTests,
  getLastDatasetImportRun,
  registerSjmsDatasetImportWorker,
  runDatasetImportOnce,
} from '../../workers/sjms-dataset-import.worker';

const ORIGINAL_ENABLE = process.env[SJMS_DATASET_ENABLE_ENV];
const ORIGINAL_SOURCE = process.env[SJMS_DATASET_SOURCE_ENV];
const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

/** Build a fake `child_process.spawn` that resolves with the configured exit code. */
function makeFakeSpawn(exitCode: number): {
  spawnFn: typeof SpawnFn;
  calls: { cmd: string; args: readonly string[] }[];
} {
  const calls: { cmd: string; args: readonly string[] }[] = [];
  const spawnFn = ((cmd: string, args: readonly string[]) => {
    calls.push({ cmd, args });
    const emitter = {
      on(event: string, cb: (code?: number) => void) {
        if (event === 'exit') {
          // Resolve asynchronously so the awaiter sees the resolution.
          queueMicrotask(() => cb(exitCode));
        }
        return emitter;
      },
    };
    return emitter as unknown as ChildProcess;
  }) as unknown as typeof SpawnFn;
  return { spawnFn, calls };
}

afterEach(() => {
  if (ORIGINAL_ENABLE === undefined) delete process.env[SJMS_DATASET_ENABLE_ENV];
  else process.env[SJMS_DATASET_ENABLE_ENV] = ORIGINAL_ENABLE;
  if (ORIGINAL_SOURCE === undefined) delete process.env[SJMS_DATASET_SOURCE_ENV];
  else process.env[SJMS_DATASET_SOURCE_ENV] = ORIGINAL_SOURCE;
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
  __resetLastDatasetImportRunForTests();
});

describe('sjms-dataset-import.worker constants', () => {
  it('schedules Sunday 09:00 Europe/Zurich to match the Maieus2 datalake cadence', () => {
    // The slot is load-bearing: both consumers pull from the same gdrive5tb
    // snapshot refreshed by the Workhorse cron at Sun 06:00 Europe/Zurich.
    // Three hours of headroom protects against a slow rclone sync. Do not
    // tighten without checking the upstream cron at RJK134/Macbook.
    expect(SJMS_DATASET_CRON_PATTERN).toBe('0 9 * * 0');
    expect(SJMS_DATASET_CRON_TIMEZONE).toBe('Europe/Zurich');
  });

  it('names the queue and job consistently with the central registry', () => {
    expect(SJMS_DATASET_QUEUE_NAME).toBe('sjms-dataset-import');
    expect(SJMS_DATASET_JOB_NAME).toBe('weekly-dataset-import');
    expect(SJMS_DATASET_JOB_NAME_MANUAL).toBe('manual-dataset-import');
  });

  it('exposes a default source so unset env behaves predictably', () => {
    expect(SJMS_DATASET_DEFAULT_SOURCE).toBe('./output/latest');
  });

  it('reads the enable flag from SJMS_ENABLE_DATASET_SCHEDULER', () => {
    expect(SJMS_DATASET_ENABLE_ENV).toBe('SJMS_ENABLE_DATASET_SCHEDULER');
  });

  it('reads the source override from SJMS_DATASET_SOURCE', () => {
    expect(SJMS_DATASET_SOURCE_ENV).toBe('SJMS_DATASET_SOURCE');
  });
});

describe('runDatasetImportOnce', () => {
  it('spawns `node scripts/import-sjms-dataset.mjs --source <env> --persist`', async () => {
    process.env[SJMS_DATASET_SOURCE_ENV] = 'gdrive5tb:sjms-5-dataset/latest/';
    const { spawnFn, calls } = makeFakeSpawn(0);

    const code = await runDatasetImportOnce({ spawnImpl: spawnFn, projectRoot: '/tmp/sjms-test' });

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('node');
    expect(calls[0].args).toEqual([
      'scripts/import-sjms-dataset.mjs',
      '--source',
      'gdrive5tb:sjms-5-dataset/latest/',
      '--persist',
    ]);
  });

  it('falls back to the default source when SJMS_DATASET_SOURCE is unset', async () => {
    delete process.env[SJMS_DATASET_SOURCE_ENV];
    const { spawnFn, calls } = makeFakeSpawn(0);

    await runDatasetImportOnce({ spawnImpl: spawnFn, projectRoot: '/tmp/sjms-test' });

    expect(calls[0].args).toContain('--source');
    const sourceIndex = calls[0].args.indexOf('--source');
    expect(calls[0].args[sourceIndex + 1]).toBe(SJMS_DATASET_DEFAULT_SOURCE);
  });

  it('honours an explicit `source` override over the env var', async () => {
    process.env[SJMS_DATASET_SOURCE_ENV] = 'gdrive5tb:env-source/';
    const { spawnFn, calls } = makeFakeSpawn(0);

    await runDatasetImportOnce({
      spawnImpl: spawnFn,
      projectRoot: '/tmp/sjms-test',
      source: '/override/path',
    });

    const sourceIndex = calls[0].args.indexOf('--source');
    expect(calls[0].args[sourceIndex + 1]).toBe('/override/path');
  });

  it('propagates non-zero exit codes from the subprocess', async () => {
    const { spawnFn } = makeFakeSpawn(2);
    const code = await runDatasetImportOnce({ spawnImpl: spawnFn, projectRoot: '/tmp/sjms-test' });
    expect(code).toBe(2);
  });
});

describe('registerSjmsDatasetImportWorker', () => {
  beforeEach(() => {
    __resetLastDatasetImportRunForTests();
  });

  it('is a no-op when SJMS_ENABLE_DATASET_SCHEDULER is unset', () => {
    delete process.env[SJMS_DATASET_ENABLE_ENV];
    // No REDIS_URL — the underlying createWorker would throw if reached.
    delete process.env.REDIS_URL;

    expect(() => registerSjmsDatasetImportWorker()).not.toThrow();
    expect(getLastDatasetImportRun()).toBeNull();
  });

  it('is a no-op when the enable flag is set to a non-`true` value', () => {
    process.env[SJMS_DATASET_ENABLE_ENV] = 'false';
    delete process.env.REDIS_URL;

    expect(() => registerSjmsDatasetImportWorker()).not.toThrow();
  });

  it('refuses to register without REDIS_URL when enabled', () => {
    process.env[SJMS_DATASET_ENABLE_ENV] = 'true';
    delete process.env.REDIS_URL;

    // The underlying utils/queue.ts::getQueue throws the same clear error
    // we use across the worker scaffold — keeps the dev failure mode loud.
    expect(() => registerSjmsDatasetImportWorker()).toThrow(/BullMQ requires REDIS_URL/);
  });
});

describe('getLastDatasetImportRun', () => {
  it('returns null before the worker has processed any job', () => {
    __resetLastDatasetImportRunForTests();
    expect(getLastDatasetImportRun()).toBeNull();
  });
});
