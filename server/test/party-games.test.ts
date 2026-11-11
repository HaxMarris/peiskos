// Odd One Out and Same Page: the server seats them, the picker lists them, and their word lists hold up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { GAMES } from '../src/games.ts';

const games = join(import.meta.dirname, '..', '..', 'client', 'games');
/** A client list file's one top-level const, read without a browser. */
const list = (file: string, name: string) => runInNewContext(`${readFileSync(join(games, file), 'utf8')}; ${name}`) as unknown[];
const plain = (text: string) => text.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

test('every game the server seats has a page and a place in the picker, with the same player limit', () => {
  const picker = readFileSync(join(games, '..', 'js', 'games.js'), 'utf8');
  for (const [name, max] of Object.entries(GAMES)) {
    assert.ok(existsSync(join(games, name, 'index.html')), `${name} has a page`);
    const entry = new RegExp(`\\n  ${name}: \\{[^}]*maxPlayers: (\\d+)`).exec(picker);
    assert.equal(Number(entry?.[1]), max, `${name} seats ${max} in the picker too`);
  }
  assert.equal(GAMES.oddoneout, 12);
  assert.equal(GAMES.samepage, 12);
});

test("Odd One Out's pairs are two different words, and no word comes up twice", () => {
  const pairs = list('oddoneout/words.js', 'WORD_PAIRS') as string[][];
  assert.ok(pairs.length >= 150);
  const seen = new Set<string>();
  for (const pair of pairs) {
    assert.equal(pair.length, 2);
    const [a, b] = pair.map(plain);
    assert.ok(a && b && a !== b, `${pair} are two words`);
    // A clue can't contain your word, so one word inside the other would give the odd one out away.
    assert.ok(!a.includes(b) && !b.includes(a), `${pair} don't contain each other`);
    for (const w of [a, b]) {
      assert.ok(!seen.has(w), `${w} is only in one pair`);
      seen.add(w);
    }
  }
});

test("Same Page's prompts are all different and fit on a phone", () => {
  const prompts = list('samepage/prompts.js', 'PROMPTS') as string[];
  assert.ok(prompts.length >= 150);
  assert.equal(new Set(prompts.map(plain)).size, prompts.length);
  for (const p of prompts) assert.ok(p.length <= 70, p);
});
