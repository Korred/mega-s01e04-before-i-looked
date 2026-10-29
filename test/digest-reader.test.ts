import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const night = '2026-10-28';
const event = { at: '2026-10-29T01:30:00+01:00', job: 'refresh', status: 'retry', owner: 'rook', error: 'upstream 503' };
let runsDir: string;

beforeEach(async () => { runsDir = await mkdtemp(join(tmpdir(), 'rig-reader-')); });
afterEach(async () => { await rm(runsDir, { recursive: true, force: true }); });

async function writeLines(lines: unknown[]) {
  await writeFile(join(runsDir, `${night}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
}

describe('readNight', () => {
  it('reads the real night without changing its fixtures', async () => {
    const digest = await readNight('runs', night);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows.find((row) => row.job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
      lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest?.rows[0].owner).toBeNull();
    expect(digest?.rows.find((row) => row.job === 'lane/sync')?.runs).toBe(8);
    expect(digest?.rows.find((row) => row.job === 'notes/backup')?.lastStatus).toBe('fail');
  });

  it('aggregates in file order, retaining raw offsets and the last error after recovery', async () => {
    await writeLines([
      { ...event, job: 'zebra' },
      event,
      { ...event, status: 'fail', error: 'new error' },
      { at: '2026-10-28T20:00:00-05:30', job: 'refresh', status: 'ok', owner: null },
    ]);
    const digest = await readNight(runsDir, night);
    expect(digest?.counts).toEqual({ ok: 1, retry: 2, fail: 1 });
    expect(digest?.rows[0]).toEqual({
      job: 'refresh', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'new error',
      firstAt: event.at, lastAt: '2026-10-28T20:00:00-05:30',
    });
  });

  it('counts malformed JSON and invalid events without losing valid records', async () => {
    const invalid = [
      null, [], 42, {}, { ...event, job: '' }, { ...event, job: ' ' },
      { ...event, status: 'pending' }, { ...event, status: ['ok'] },
      { ...event, owner: 3 }, { ...event, owner: undefined }, { ...event, error: null },
      { ...event, at: 'yesterday' }, { ...event, at: '2026-02-30T01:00:00Z' },
      { ...event, at: '2026-10-29T01:30:00' },
    ];
    await writeLines([...invalid, event]);
    await writeFile(join(runsDir, `${night}.jsonl`), '\r\n{broken\r\n\r\n', { flag: 'a' });
    const digest = await readNight(runsDir, night);
    expect(digest?.badLines).toBe(invalid.length + 2);
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.rows[0].runs).toBe(1);
    expect(digest?.counts).toEqual({ ok: 0, retry: 1, fail: 0 });
  });

  it('distinguishes an empty file from missing or invalid nights', async () => {
    expect(await readNight(runsDir, night)).toBeNull();
    await writeFile(join(runsDir, `${night}.jsonl`), '');
    expect(await readNight(runsDir, night)).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    for (const invalid of ['../2026-10-28', '/2026-10-28', '2026-10-28.jsonl', '2026-02-30', '2026-13-01', '']) {
      expect(await readNight(runsDir, invalid)).toBeNull();
    }
  });

  it('propagates file read errors other than a missing file', async () => {
    await mkdir(join(runsDir, `${night}.jsonl`));
    await expect(readNight(runsDir, night)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
