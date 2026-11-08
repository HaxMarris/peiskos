// Fireside Trivia's questions and Sketch & Guess's words.
//
// Questions come in packs (server/trivia/*.json, read once at start) plus each hearth's own. A hearth
// remembers which questions it has had, so a round picks ones it hasn't seen; once a category runs
// low, that category's memory starts over. Whoever hosts a game asks for its questions through
// Peiskos, so the answers reach only their copy of the game.
import { randomInt } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';
import type { Json } from './http.ts';

export type TriviaQuestion = { id: string; c: string; d: 'easy' | 'medium' | 'hard'; q: string; a: string; w: string[]; tf?: boolean; pack: string };
type Pack = { name: string; credit: string; questions: TriviaQuestion[] };

const OWN = 'Our hearth';
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const MAX_OWN_QUESTIONS = 500;
const MAX_WORDS = 500;

/** Every pack in the folder. A broken file is skipped (and said so) rather than stopping Peiskos. */
export function loadPacks(dir: string): Pack[] {
  if (!existsSync(dir)) return [];
  const packs: Pack[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { name?: string; credit?: string; questions?: Json[] };
      const name = String(raw.name ?? file);
      const questions = (raw.questions ?? []).filter((q) =>
        typeof q.id === 'string' && typeof q.q === 'string' && typeof q.a === 'string' && Array.isArray(q.w) && q.w.length >= 1
        && typeof q.c === 'string' && DIFFICULTIES.includes(q.d as string),
      ).map((q) => ({ ...(q as unknown as TriviaQuestion), pack: name }));
      packs.push({ name, credit: String(raw.credit ?? ''), questions });
    } catch (err) {
      console.error(`Trivia pack ${file} couldn't be read:`, err);
    }
  }
  return packs;
}

export interface TriviaContext {
  db: Db;
  route: (method: string, path: string, handler: (c: { user: { id: number }; params: string[]; body: Json; url: URL }) => unknown) => void;
  fail: (status: number, message: string) => Error;
  isMember: (serverId: number, userId: number) => boolean;
  isBurrow: (serverId: number) => boolean;
  can: (serverId: number, userId: number, perm: 'messages') => boolean;
  packDir: string;
}

export function trivia(ctx: TriviaContext) {
  const { db, route, fail } = ctx;
  const now = () => Date.now();
  const packs = loadPacks(ctx.packDir);
  const all = packs.flatMap((p) => p.questions);
  const byId = new Map(all.map((q) => [q.id, q]));
  const credits = new Map(packs.map((p) => [p.name, p.credit]));

  /** A hearth you're in. */
  const hearth = (userId: number, raw: unknown) => {
    const serverId = Number(raw);
    if (!ctx.isBurrow(serverId) || !ctx.isMember(serverId, userId)) throw fail(404, "That hearth is gone, or you're not in it.");
    return serverId;
  };
  const ownQuestions = (serverId: number) =>
    (db.prepare('SELECT id, question, answer, wrong, author_id AS authorId, created_at AS createdAt FROM trivia_own WHERE server_id = ? ORDER BY id').all(serverId) as
      { id: number; question: string; answer: string; wrong: string; authorId: number | null; createdAt: number }[]);
  const asQuestion = (o: ReturnType<typeof ownQuestions>[number]): TriviaQuestion =>
    ({ id: `own-${o.id}`, c: OWN, d: 'medium', q: o.question, a: o.answer, w: JSON.parse(o.wrong) as string[], pack: OWN });

  // The categories, with how many questions each has (a hearth's own questions are one more).
  route('GET', '/api/trivia/categories', ({ user, url }) => {
    const serverId = hearth(user.id, url.searchParams.get('serverId'));
    const counts = new Map<string, number>();
    for (const q of all) counts.set(q.c, (counts.get(q.c) ?? 0) + 1);
    const own = ownQuestions(serverId).length;
    return {
      categories: [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })).concat(own ? [{ name: OWN, count: own }] : []),
      total: all.length + own,
    };
  });

  // A round's questions for the host's game: ones this hearth hasn't had yet, answers shuffled.
  route('POST', '/api/trivia/round', ({ user, body }) => {
    const serverId = hearth(user.id, body.serverId);
    const count = Math.min(30, Math.max(3, Math.floor(Number(body.count)) || 10));
    const wanted = Array.isArray(body.categories) ? new Set(body.categories.map(String)) : null;
    const difficulty = DIFFICULTIES.includes(body.difficulty as string) ? (body.difficulty as string) : null;
    const pool = [...all, ...ownQuestions(serverId).map(asQuestion)]
      .filter((q) => (!wanted || !wanted.size || wanted.has(q.c)) && (!difficulty || q.d === difficulty || q.c === OWN));
    if (!pool.length) throw fail(400, 'No questions match that. Pick more categories.');
    const seen = new Set((db.prepare('SELECT question_id FROM trivia_seen WHERE server_id = ?').all(serverId) as { question_id: string }[]).map((r) => r.question_id));
    let fresh = pool.filter((q) => !seen.has(q.id));
    if (fresh.length < count) {
      // Most of these have come up already: start over on them (keeping this round's leftovers first).
      const forget = db.prepare('DELETE FROM trivia_seen WHERE server_id = ? AND question_id = ?');
      for (const q of pool) if (seen.has(q.id)) forget.run(serverId, q.id);
      fresh = [...fresh, ...pool.filter((q) => seen.has(q.id))];
    }
    const picked: TriviaQuestion[] = [];
    const left = [...fresh];
    // Unseen first, in random order; the leftovers (if any had to be reused) after.
    const unseen = left.filter((q) => !seen.has(q.id));
    const reused = left.filter((q) => seen.has(q.id));
    for (const list of [unseen, reused]) {
      while (picked.length < count && list.length) picked.push(list.splice(randomInt(list.length), 1)[0]);
    }
    const mark = db.prepare('INSERT OR IGNORE INTO trivia_seen (server_id, question_id, seen_at) VALUES (?, ?, ?)');
    for (const q of picked) mark.run(serverId, q.id, now());
    const usedCredits = [...new Set(picked.map((q) => credits.get(q.pack)).filter(Boolean))];
    return {
      credits: usedCredits,
      questions: picked.map((q) => {
        const answers = q.tf ? ['True', 'False'] : [q.a, ...q.w.slice(0, 3)];
        if (!q.tf) for (let i = answers.length - 1; i > 0; i--) { const j = randomInt(i + 1); [answers[i], answers[j]] = [answers[j], answers[i]]; }
        return { id: q.id, category: q.c, difficulty: q.d, question: q.q, answers, correct: answers.indexOf(q.a) };
      }),
    };
  });

  // ---- a hearth's own questions

  const cleanText = (v: unknown, what: string, max: number) => {
    const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
    if (!s) throw fail(400, `Write the ${what}`);
    if (s.length > max) throw fail(400, `Keep the ${what} to ${max} characters`);
    return s;
  };
  const ownList = (serverId: number, userId: number) => ({
    questions: ownQuestions(serverId).map((o) => ({ id: o.id, question: o.question, answer: o.answer, wrong: JSON.parse(o.wrong), mine: o.authorId === userId })),
  });
  route('GET', '/api/servers/:id/trivia', ({ user, params }) => ownList(hearth(user.id, params[0]), user.id));
  route('POST', '/api/servers/:id/trivia', ({ user, params, body }) => {
    const serverId = hearth(user.id, params[0]);
    const question = cleanText(body.question, 'question', 300);
    const answer = cleanText(body.answer, 'right answer', 100);
    const wrong = (Array.isArray(body.wrong) ? body.wrong : []).filter((w) => typeof w === 'string' && w.trim()).map((w) => cleanText(w, 'wrong answer', 100));
    if (wrong.length < 1 || wrong.length > 3) throw fail(400, 'Give one to three wrong answers');
    if (new Set([answer, ...wrong].map((x) => x.toLowerCase())).size !== wrong.length + 1) throw fail(400, 'Each answer must be different');
    if (ownQuestions(serverId).length >= MAX_OWN_QUESTIONS) throw fail(400, `A hearth can have up to ${MAX_OWN_QUESTIONS} of its own questions`);
    db.prepare('INSERT INTO trivia_own (server_id, author_id, question, answer, wrong, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(serverId, user.id, question, answer, JSON.stringify(wrong), now());
    return ownList(serverId, user.id);
  });
  route('DELETE', '/api/servers/:id/trivia/:q', ({ user, params }) => {
    const serverId = hearth(user.id, params[0]);
    const row = db.prepare('SELECT author_id FROM trivia_own WHERE id = ? AND server_id = ?').get(Number(params[1]), serverId) as { author_id: number | null } | undefined;
    if (!row) throw fail(404, "That question isn't there any more");
    if (row.author_id !== user.id && !ctx.can(serverId, user.id, 'messages')) throw fail(403, 'Only whoever wrote it can take it out');
    db.prepare('DELETE FROM trivia_own WHERE id = ?').run(Number(params[1]));
    return ownList(serverId, user.id);
  });

  // ---- a hearth's own words for Sketch & Guess

  const wordsOf = (serverId: number) =>
    (db.prepare('SELECT word FROM game_words WHERE server_id = ? ORDER BY word').all(serverId) as { word: string }[]).map((r) => r.word);
  route('GET', '/api/servers/:id/game-words', ({ user, params }) => ({ words: wordsOf(hearth(user.id, params[0])) }));
  // The whole list at once: what's sent replaces what was there.
  route('PUT', '/api/servers/:id/game-words', ({ user, params, body }) => {
    const serverId = hearth(user.id, params[0]);
    const words = [...new Set((Array.isArray(body.words) ? body.words : [])
      .map((w) => (typeof w === 'string' ? w.replace(/\s+/g, ' ').trim().toLowerCase() : ''))
      // A word needs a letter or number to guess (an emoji alone can't be hidden or typed).
      .filter((w) => w && w.length <= 30 && /[\p{L}\p{N}]/u.test(w)))];
    if (words.length > MAX_WORDS) throw fail(400, `A hearth can have up to ${MAX_WORDS} words`);
    db.prepare('DELETE FROM game_words WHERE server_id = ?').run(serverId);
    const add = db.prepare('INSERT INTO game_words (server_id, word) VALUES (?, ?)');
    for (const w of words) add.run(serverId, w);
    return { words: wordsOf(serverId) };
  });

  return { packs, questionCount: () => all.length, byId };
}
