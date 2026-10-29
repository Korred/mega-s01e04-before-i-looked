import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const night = '2026-10-28';
const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};
let runsDir: string;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-route-'));
  config.runsDir = runsDir;
});

afterEach(async () => { await rm(runsDir, { recursive: true, force: true }); });

async function writeNight(contents: string) {
  await writeFile(join(runsDir, `${night}.jsonl`), contents);
}

describe('digest routes', () => {
  it('returns the same sorted digest as HTML and JSON', async () => {
    const events = [
      { at: '2026-10-29T01:30:00+01:00', job: 'zeta', status: 'ok', owner: null },
      { at: '2026-10-29T01:31:00+01:00', job: 'alpha', status: 'retry', owner: 'rook' },
      { at: '2026-10-29T01:32:00+01:00', job: 'alpha', status: 'retry', owner: 'rook' },
      { at: '2026-10-29T01:33:00+01:00', job: 'alpha', status: 'retry', owner: 'rook' },
      { at: '2026-10-28T20:00:00-05:30', job: 'alpha', status: 'fail', owner: 'rook', error: 'upstream 503' },
    ];
    await writeNight(`${events.map((event) => JSON.stringify(event)).join('\n')}\nnot-json\n`);

    const app = createApp(config);
    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();
    const digest = await jsonResponse.json();

    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('bad lines · 1');
    expect(html).toContain('—');
    expect(html).toContain('2026-10-28T20:00:00-05:30');
    expect(html).toContain('upstream 503');
    expect(html).not.toMatch(/<script\b/i);
    expect(html.indexOf('alpha')).toBeLessThan(html.indexOf('zeta'));
    expect(html).toMatch(/<td class="warn">3<\/td>/);
    expect(html).toMatch(/<td class="warn">fail<\/td>/);

    expect(jsonResponse.status).toBe(200);
    expect(digest).toEqual({
      rows: [
        {
          job: 'alpha', owner: 'rook', runs: 4, retries: 3, lastStatus: 'fail',
          lastError: 'upstream 503', firstAt: '2026-10-29T01:31:00+01:00',
          lastAt: '2026-10-28T20:00:00-05:30',
        },
        {
          job: 'zeta', owner: null, runs: 1, retries: 0, lastStatus: 'ok',
          lastError: null, firstAt: '2026-10-29T01:30:00+01:00',
          lastAt: '2026-10-29T01:30:00+01:00',
        },
      ],
      badLines: 1,
      counts: { ok: 1, retry: 3, fail: 1 },
    });
  });

  it('renders an empty night and returns empty rows in JSON', async () => {
    await writeNight('');
    const app = createApp(config);
    const [html, json] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);

    expect(html.status).toBe(200);
    expect(await html.text()).toContain('nothing ran');
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('returns 404 for missing and invalid nights', async () => {
    const app = createApp(config);
    for (const path of [`/digest/${night}`, `/api/digest/${night}`, '/digest/2026-02-30', '/api/digest/2026-02-30']) {
      expect((await app.request(path)).status).toBe(404);
    }
  });
});
