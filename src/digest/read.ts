import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function validNight(night: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return false;
  const date = new Date(night);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === night;
}

function isEvent(value: unknown): value is RunEvent {
  return typeof value === 'object' && value !== null
    && 'at' in value && typeof value.at === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.at)
    && validNight(value.at.slice(0, 10)) && Number.isFinite(Date.parse(value.at))
    && 'job' in value && typeof value.job === 'string' && value.job.trim().length > 0
    && 'status' in value && (value.status === 'ok' || value.status === 'retry' || value.status === 'fail')
    && 'owner' in value && (value.owner === null || typeof value.owner === 'string')
    && (!('error' in value) || typeof value.error === 'string');
}

export const readNight: ReadNight = async (runsDir, night) => {
  if (!validNight(night)) return null;

  let contents: string;
  try {
    contents = await readFile(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const rows = new Map<string, DigestRow>();
  const lines = contents.split(/\r?\n/);
  // A terminal newline ends the preceding record; it is not another blank record.
  if (lines.at(-1) === '') lines.pop();

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      digest.badLines++;
      continue;
    }
    if (!isEvent(event)) {
      digest.badLines++;
      continue;
    }

    digest.counts[event.status]++;
    const row = rows.get(event.job) ?? {
      job: event.job, owner: event.owner, runs: 0, retries: 0,
      lastStatus: event.status, lastError: null, firstAt: event.at, lastAt: event.at,
    };
    row.owner = event.owner;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    row.lastStatus = event.status;
    if (event.error !== undefined) row.lastError = event.error;
    row.lastAt = event.at;
    rows.set(event.job, row);
  }

  digest.rows = [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
