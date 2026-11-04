import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { loadPacks } from '../src/trivia.ts';

// A small pack: 6 questions in two categories, so running out and starting over can be seen.
const dir = mkdtempSync(join(tmpdir(), 'burrow-trivia-'));
const q = (id: string, c: string) => ({ id, c, d: 'easy', q: `Question ${id}?`, a: 'Right', w: ['Wrong 1', 'Wrong 2', 'Wrong 3'] });
writeFileSync(join(dir, 'test.json'), JSON.stringify({ name: 'Test', credit: 'Test pack credit', questions: [q('a1', 'Animals'), q('a2', 'Animals'), q('a3', 'Animals'), q('a4', 'Animals'), q('g1', 'Geography'), q('g2', 'Geography')] }));
writeFileSync(join(dir, 'broken.json'), '{ not json');

const app = createApp({ db: openDb(':memory:'), publicDir: '/nonexistent', triviaDir: dir });
let base = '';
before(async () => {
  await new Promise<void>((r) => app.listen(0, r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(() => { app.closeAllConnections(); app.close(); });

async function call(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as any };
}

test('the real packs load, with unique ids', () => {
  const packs = loadPacks(new URL('../trivia/', import.meta.url).pathname);
  const ids = packs.flatMap((p) => p.questions.map((x) => x.id));
  assert.ok(ids.length > 4000, `only ${ids.length} questions`);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of packs) for (const x of p.questions) assert.ok(!x.w.includes(x.a), `${x.id} has its answer among the wrong ones`);
});

test('rounds bring questions the hearth has not had, then start over', async () => {
  const max = (await call('/api/register', { body: { username: 'triv_max', password: 'password1' } })).data;
  const eve = (await call('/api/register', { body: { username: 'triv_eve', password: 'password1' } })).data;
  const s = (await call('/api/servers', { body: { name: 'Quiz' }, token: max.token })).data;
  const cats = (await call(`/api/trivia/categories?serverId=${s.id}`, { token: max.token })).data;
  assert.deepEqual(cats.categories.map((c: any) => c.name), ['Animals', 'Geography']);
  assert.equal((await call(`/api/trivia/categories?serverId=${s.id}`, { token: eve.token })).status, 404);

  const round = (count: number, categories?: string[]) => call('/api/trivia/round', { body: { serverId: s.id, count, categories }, token: max.token }).then((r) => r.data);
  const first = await round(3, ['Animals']);
  assert.equal(first.questions.length, 3);
  assert.deepEqual(first.credits, ['Test pack credit']);
  for (const x of first.questions) {
    assert.equal(x.answers.length, 4);
    assert.equal(x.answers[x.correct], 'Right');
  }
  const second = await round(3, ['Animals']);
  const firstIds = new Set(first.questions.map((x: any) => x.id));
  // Only one Animals question was left unseen, so it comes first, then old ones again.
  const unseen = second.questions.filter((x: any) => !firstIds.has(x.id));
  assert.equal(unseen.length, 1);
  assert.equal(second.questions[0].id, unseen[0].id);

  // A hearth's own questions join in under "Our hearth".
  assert.equal((await call(`/api/servers/${s.id}/trivia`, { body: { question: 'Who brings snacks?', answer: 'Sam', wrong: ['Sam'] }, token: max.token })).status, 400);
  const own = (await call(`/api/servers/${s.id}/trivia`, { body: { question: 'Who brings snacks?', answer: 'Sam', wrong: ['Max', 'Ann'] }, token: max.token })).data;
  assert.equal(own.questions.length, 1);
  const ours = await round(3, ['Our hearth']);
  assert.equal(ours.questions[0].question, 'Who brings snacks?');
  assert.equal(ours.questions[0].answers.length, 3);
  assert.deepEqual((await call(`/api/servers/${s.id}/trivia/${own.questions[0].id}`, { method: 'DELETE', token: max.token })).data.questions, []);

  // Words for Sketch & Guess.
  const words = (await call(`/api/servers/${s.id}/game-words`, { method: 'PUT', body: { words: ['Moose', 'moose', ' Canoe  trip ', ''] }, token: max.token })).data.words;
  assert.deepEqual(words, ['canoe trip', 'moose']);
});
