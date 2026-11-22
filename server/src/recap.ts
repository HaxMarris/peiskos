// The year at the fire: a hearth's year in numbers (messages, time at its fires, fish and the casino)
// with each person's own year beside it, read alone or swiped through together at a fire.
//
// Only what the reader can see counts: private rooms they're not in are left out of every number.
// Time at the fire has been logged since 2026-10-24 (voice_time), so 2026 starts there.
//
// Showing it at a fire: anyone sitting there picks the year and the card, and everyone else at that
// fire follows along. The "you" cards show each person their own numbers at the same moment.
import type { Db } from './db.ts';
import { allowance, type Json } from './http.ts';
import { boardDay, boardWorth, loadFishingData, loadSpecies } from './fishing.ts';
import { CASES, type Skin } from './casino-items.ts';

const HOUR = 3600_000;
const MAX_CARD = 24;
/** A show nobody has moved on for this long is over. */
const SHOW_IDLE_MS = 3 * HOUR;

type User = { id: number; username: string };
type Channel = { id: number; serverId: number; kind: string; name: string; parentId?: number | null };
type Handler = (ctx: { user: User; params: string[]; body: Json }) => unknown;

export interface RecapContext {
  db: Db;
  route: (method: string, path: string, handler: Handler) => void;
  fail: (status: number, message: string) => Error;
  isMember: (serverId: number, userId: number) => boolean;
  canSee: (channel: never, userId: number) => boolean;
  channelById: (id: number) => Channel | undefined;
  inVoice: Map<number, number>;
  usersInVoice: (channelId: number) => number[];
  broadcastToChannel: (channel: never, event: Json) => void;
  now?: () => number;
}

type Visit = { userId: number; channelId: number; start: number; end: number };

/** The longest stretch a fire stayed lit (someone sat there the whole time), and who came by during it. */
export function longestLit(visits: Visit[]) {
  let best: { start: number; end: number; people: Set<number> } | null = null;
  const byFire = new Map<number, Visit[]>();
  for (const v of visits) (byFire.get(v.channelId) ?? byFire.set(v.channelId, []).get(v.channelId)!).push(v);
  for (const list of byFire.values()) {
    list.sort((a, b) => a.start - b.start);
    let cur: { start: number; end: number; people: Set<number> } | null = null;
    for (const v of list) {
      if (cur && v.start <= cur.end) {
        cur.end = Math.max(cur.end, v.end);
        cur.people.add(v.userId);
      } else cur = { start: v.start, end: v.end, people: new Set([v.userId]) };
      if (!best || cur.end - cur.start > best.end - best.start) best = cur; // cur keeps growing, so best sees who comes later
    }
  }
  return best;
}

/** The most people at one fire at once, and when that first happened. */
export function mostAtOnce(visits: Visit[]) {
  let best = { n: 0, at: 0 };
  const byFire = new Map<number, Visit[]>();
  for (const v of visits) (byFire.get(v.channelId) ?? byFire.set(v.channelId, []).get(v.channelId)!).push(v);
  for (const list of byFire.values()) {
    // Leaving sorts before arriving at the same moment, so a hand-over isn't counted as two people.
    // People are counted once however their visits overlap (a restart can leave two rows).
    const edges = list.flatMap((v) => [[v.start, 1, v.userId], [v.end, -1, v.userId]] as [number, number, number][]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const here = new Map<number, number>();
    for (const [t, d, userId] of edges) {
      const k = (here.get(userId) ?? 0) + d;
      if (k > 0) here.set(userId, k);
      else here.delete(userId);
      if (here.size > best.n) best = { n: here.size, at: t };
    }
  }
  return best;
}

/** Who someone shared the most time at the fire with: the overlap of their visits with everyone else's. */
export function sharedTime(visits: Visit[], userId: number) {
  const mine = visits.filter((v) => v.userId === userId);
  const shared = new Map<number, number>();
  for (const o of visits) {
    if (o.userId === userId) continue;
    for (const m of mine) {
      if (m.channelId !== o.channelId) continue;
      const ms = Math.min(m.end, o.end) - Math.max(m.start, o.start);
      if (ms > 0) shared.set(o.userId, (shared.get(o.userId) ?? 0) + ms);
    }
  }
  return [...shared].sort((a, b) => b[1] - a[1]);
}

export function recap(ctx: RecapContext) {
  const { db, route, fail } = ctx;
  const clock = ctx.now ?? Date.now;
  const fishData = loadFishingData();
  const species = loadSpecies(fishData);
  const skins = new Map<string, Skin>();
  for (const c of CASES) for (const s of c.skins) skins.set(s.id, s);

  const hearth = (serverId: number, userId: number) => {
    const s = db.prepare('SELECT kind, name FROM servers WHERE id = ?').get(serverId) as { kind: string; name: string } | undefined;
    if (!s || s.kind !== 'burrow' || !ctx.isMember(serverId, userId)) throw fail(404, "That hearth is gone, or you're not in it.");
    return s;
  };

  const yearOf = (serverId: number, user: User, year: number) => {
    if (!(year >= 2000 && year <= 2100)) throw fail(400, 'Pick a year');
    const from = Date.UTC(year, 0, 1), to = Date.UTC(year + 1, 0, 1);
    const channels = (db.prepare('SELECT id FROM channels WHERE server_id = ?').all(serverId) as { id: number }[])
      .map((c) => ctx.channelById(c.id)!)
      .filter((c) => c && ctx.canSee(c as never, user.id));
    const ids = channels.map((c) => c.id);
    const roomOf = new Map(channels.map((c) => [c.id, c.kind === 'thread' && c.parentId ? c.parentId : c.id]));
    const inList = ids.length ? ids.join(',') : 'NULL';
    const inYear = `m.channel_id IN (${inList}) AND m.created_at >= ${from} AND m.created_at < ${to}`;
    const nameOf = `COALESCE((SELECT nickname FROM members WHERE server_id = ${serverId} AND user_id = u.id), u.display_name, u.username)`;
    const nameById = (id: number) =>
      (db.prepare(`SELECT ${nameOf} AS name FROM users u WHERE u.id = ?`).get(id) as { name: string } | undefined)?.name ?? 'Someone';
    const count = (sql: string, ...args: number[]) => (db.prepare(sql).get(...args) as { n: number }).n;

    // ---- words
    const messages = count(`SELECT COUNT(*) AS n FROM messages m WHERE ${inYear}`);
    const roomCounts = (extra = '', ...args: number[]) => {
      const rooms = new Map<number, number>();
      for (const r of db.prepare(`SELECT m.channel_id AS id, COUNT(*) AS n FROM messages m WHERE ${inYear} ${extra} GROUP BY m.channel_id`).all(...args) as { id: number; n: number }[]) {
        const room = roomOf.get(r.id)!;
        rooms.set(room, (rooms.get(room) ?? 0) + r.n);
      }
      return [...rooms]
        .map(([id, n]) => ({ id, name: ctx.channelById(id)?.name ?? '?', messages: n }))
        .filter((r) => ctx.channelById(r.id)?.kind !== 'voice')
        .sort((a, b) => b.messages - a.messages);
    };
    const topRooms = roomCounts().slice(0, 5);
    const topReactions = db
      .prepare(`SELECT r.emoji, COUNT(*) AS n FROM reactions r JOIN messages m ON m.id = r.message_id WHERE ${inYear} GROUP BY r.emoji ORDER BY n DESC, MIN(r.created_at) LIMIT 8`)
      .all();
    const talkers = db
      .prepare(`SELECT u.id, ${nameOf} AS name, COUNT(*) AS n FROM messages m JOIN users u ON u.id = m.author_id
                WHERE ${inYear} AND u.bot = 0 AND u.deleted_at IS NULL GROUP BY u.id ORDER BY n DESC, MIN(m.id)`)
      .all() as { id: number; name: string; n: number }[];
    const topPeople = talkers.slice(0, 5);
    const mostLoved = db
      .prepare(`SELECT m.id, m.channel_id AS channelId, substr(m.content, 1, 160) AS content, ${nameOf} AS author, COUNT(r.user_id) AS reactions
                FROM messages m JOIN reactions r ON r.message_id = m.id JOIN users u ON u.id = m.author_id
                WHERE ${inYear} AND m.content != '' GROUP BY m.id ORDER BY reactions DESC, m.id LIMIT 1`)
      .get() ?? null;
    const busiestDay = db
      .prepare(`SELECT date(m.created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM messages m WHERE ${inYear} GROUP BY day ORDER BY n DESC, day LIMIT 1`)
      .get() ?? null;
    const busiestMonth = db
      .prepare(`SELECT CAST(strftime('%m', m.created_at / 1000, 'unixepoch') AS INTEGER) AS month, COUNT(*) AS n FROM messages m WHERE ${inYear} GROUP BY month ORDER BY n DESC, month LIMIT 1`)
      .get() ?? null;
    const newPeople = count('SELECT COUNT(*) AS n FROM members WHERE server_id = ? AND joined_at >= ? AND joined_at < ?', serverId, from, to);

    // ---- the fire. Time at the hearth's AFK fire doesn't count.
    const visits = (db
      .prepare(`SELECT user_id AS userId, channel_id AS channelId, started_at AS start, ended_at AS end FROM voice_time
                WHERE server_id = ? AND started_at >= ? AND started_at < ? AND ended_at > started_at
                  AND channel_id IS NOT (SELECT afk_channel_id FROM servers WHERE id = ?)`)
      .all(serverId, from, to, serverId) as Visit[]);
    const hoursOf = (list: Visit[]) => list.reduce((a, v) => a + v.end - v.start, 0) / HOUR;
    const nights = (list: Visit[]) => new Set(list.map((v) => boardDay(v.start))).size;
    const perPerson = new Map<number, number>();
    for (const v of visits) perPerson.set(v.userId, (perPerson.get(v.userId) ?? 0) + v.end - v.start);
    const fireRank = [...perPerson].sort((a, b) => b[1] - a[1]);
    const topFire = fireRank.slice(0, 3).map(([id, ms]) => ({ id, name: nameById(id), hours: ms / HOUR }));
    const lit = longestLit(visits);
    const crowd = mostAtOnce(visits);
    const fire = {
      hours: hoursOf(visits),
      nights: nights(visits),
      longest: lit ? { day: boardDay(lit.start), hours: (lit.end - lit.start) / HOUR, people: lit.people.size } : null,
      mostAtOnce: crowd.n ? { n: crowd.n, day: boardDay(crowd.at) } : null,
    };

    // ---- Fireside Angler: each person's best catch of each day is kept for the leaderboard.
    type Catch = { userId: number; fish: string; size: number; score: number; stars: number; giant: number; caughtAt: number };
    const catches = db
      .prepare('SELECT user_id AS userId, fish, size, score, stars, giant, caught_at AS caughtAt FROM fishing_best WHERE server_id = ? AND caught_at >= ? AND caught_at < ?')
      .all(serverId, from, to) as Catch[];
    const worth = (c: Catch) => { const sp = species.get(c.fish); return sp ? boardWorth(sp, c.score, c.stars, !!c.giant, fishData.STAR_MUL) : 0; };
    const catchView = (c: Catch | undefined) =>
      c ? { name: nameById(c.userId), fish: species.get(c.fish)?.name ?? 'A fish', size: c.size, stars: c.stars, giant: !!c.giant } : null;
    const bestOf = (list: Catch[]) => list.reduce<Catch | undefined>((b, c) => (!b || worth(c) > worth(b) ? c : b), undefined);
    const wins = db
      .prepare(`SELECT e.user_id AS userId, COUNT(*) AS n FROM fishing_derby_entries e WHERE e.server_id = ? AND e.place = 1 AND e.week >= ? AND e.week < ? GROUP BY e.user_id ORDER BY n DESC`)
      .all(serverId, `${year}-01-01`, `${year + 1}-01-01`) as { userId: number; n: number }[];
    const anglers = new Map<number, number>();
    for (const c of catches) anglers.set(c.userId, (anglers.get(c.userId) ?? 0) + 1);
    const topAngler = [...anglers].sort((a, b) => b[1] - a[1])[0];
    const fish = {
      days: catches.length,
      anglers: anglers.size,
      best: catchView(bestOf(catches)),
      topAngler: topAngler ? { name: nameById(topAngler[0]), days: topAngler[1] } : null,
      derbyChamp: wins[0] ? { name: nameById(wins[0].userId), wins: wins[0].n } : null,
    };

    // ---- the casino: skins still held (sold ones are gone), and the collection book's first finds.
    const itemView = (r: { userId: number; skinId: string; value: number; stattrak: number } | undefined) => {
      const s = r && skins.get(r.skinId);
      return s ? { name: nameById(r.userId), skin: `${s.weapon} | ${s.name}`, rarity: s.rarity, value: r.value, stattrak: !!r.stattrak } : null;
    };
    const topItem = (extra = '', ...args: number[]) =>
      db.prepare(`SELECT user_id AS userId, skin_id AS skinId, value, stattrak FROM casino_items WHERE server_id = ? AND created_at >= ? AND created_at < ? ${extra} ORDER BY value DESC, id LIMIT 1`)
        .get(serverId, from, to, ...args) as { userId: number; skinId: string; value: number; stattrak: number } | undefined;
    const found = count('SELECT COUNT(*) AS n FROM casino_found WHERE server_id = ? AND first_at >= ? AND first_at < ?', serverId, from, to);
    const chipLead = year === new Date(clock()).getUTCFullYear()
      ? (db.prepare('SELECT user_id AS userId, chips FROM casino_wallets WHERE server_id = ? ORDER BY chips DESC LIMIT 1').get(serverId) as { userId: number; chips: number } | undefined)
      : undefined;
    const casino = {
      found,
      best: itemView(topItem()),
      chipLeader: chipLead ? { name: nameById(chipLead.userId), chips: chipLead.chips } : null,
    };

    // ---- you
    const me = user.id;
    const myVisits = visits.filter((v) => v.userId === me);
    const withMost = sharedTime(visits, me)[0];
    const myCatches = catches.filter((c) => c.userId === me);
    const myRank = talkers.findIndex((t) => t.id === me);
    const myFireRank = fireRank.findIndex(([id]) => id === me);
    const firstWords = db
      .prepare(`SELECT substr(m.content, 1, 160) AS content, m.created_at AS at FROM messages m WHERE ${inYear} AND m.author_id = ? AND m.content != '' ORDER BY m.id LIMIT 1`)
      .get(me) ?? null;
    const myEmoji = db
      .prepare(`SELECT r.emoji, COUNT(*) AS n FROM reactions r JOIN messages m ON m.id = r.message_id WHERE ${inYear} AND r.user_id = ? GROUP BY r.emoji ORDER BY n DESC, MIN(r.created_at) LIMIT 1`)
      .get(me) ?? null;
    const myWallet = chipLead ? (db.prepare('SELECT chips FROM casino_wallets WHERE user_id = ? AND server_id = ?').get(me, serverId) as { chips: number } | undefined) : undefined;
    const you = {
      messages: count(`SELECT COUNT(*) AS n FROM messages m WHERE ${inYear} AND m.author_id = ?`, me),
      reactions: count(`SELECT COUNT(*) AS n FROM reactions r JOIN messages m ON m.id = r.message_id WHERE ${inYear} AND r.user_id = ?`, me),
      reactionsGot: count(`SELECT COUNT(*) AS n FROM reactions r JOIN messages m ON m.id = r.message_id WHERE ${inYear} AND m.author_id = ? AND r.user_id != ?`, me, me),
      talkRank: myRank >= 0 ? myRank + 1 : null,
      topRoom: roomCounts('AND m.author_id = ?', me)[0]?.name ?? null,
      emoji: myEmoji,
      firstWords,
      fireHours: hoursOf(myVisits),
      fireNights: nights(myVisits),
      fireRank: myFireRank >= 0 ? myFireRank + 1 : null,
      satWith: withMost ? { name: nameById(withMost[0]), hours: withMost[1] / HOUR } : null,
      fishDays: myCatches.length,
      bestCatch: catchView(bestOf(myCatches)),
      derbyWins: wins.find((w) => w.userId === me)?.n ?? 0,
      found: count('SELECT COUNT(*) AS n FROM casino_found WHERE server_id = ? AND first_at >= ? AND first_at < ? AND user_id = ?', serverId, from, to, me),
      bestSkin: itemView(topItem('AND user_id = ?', me)),
      chips: myWallet?.chips ?? null,
    };

    const first = (db.prepare(`SELECT MIN(m.created_at) AS t FROM messages m WHERE m.channel_id IN (${inList})`).get() as { t: number | null }).t;
    const thisYear = new Date(clock()).getUTCFullYear();
    const years = [];
    for (let y = thisYear; y >= new Date(first ?? clock()).getUTCFullYear(); y--) years.push(y);
    return {
      year, years, messages, topRooms, topReactions, topPeople, mostLoved, busiestDay, busiestMonth, newPeople,
      fireHours: fire.hours, topFire, fire, fish, casino, you,
    };
  };

  // /review/ is the older name, still asked for by older desktop and phone builds.
  for (const path of ['/api/servers/:id/review/:id', '/api/servers/:id/recap/:id']) {
    route('GET', path, ({ user, params }) => {
      const [serverId, year] = params.map(Number);
      const s = hearth(serverId, user.id);
      return { hearth: s.name, ...yearOf(serverId, user, year) };
    });
  }

  // ---- showing it together at a fire

  type Show = { serverId: number; year: number; card: string; by: number; at: number };
  const shows = new Map<number, Show>(); // fire's channel id -> what it's looking at
  const moves = allowance(20, 4); // swiping quickly through a few cards is fine
  const myFire = (userId: number) => {
    const id = ctx.inVoice.get(userId);
    const channel = id === undefined ? undefined : ctx.channelById(id);
    if (!channel) throw fail(400, 'Sit down at a fire first.');
    return channel;
  };
  const current = (channelId: number) => {
    const show = shows.get(channelId);
    if (show && (clock() - show.at > SHOW_IDLE_MS || !ctx.usersInVoice(channelId).length)) shows.delete(channelId);
    return shows.get(channelId) ?? null;
  };
  route('GET', '/api/voice/recap', ({ user }) => {
    const id = ctx.inVoice.get(user.id);
    return { show: id === undefined ? null : current(id) };
  });
  route('POST', '/api/voice/recap', ({ user, body }) => {
    const channel = myFire(user.id);
    if (!moves.take(user.id)) throw fail(429, 'Slow down a little.');
    if (body.stop) {
      if (shows.delete(channel.id)) ctx.broadcastToChannel(channel as never, { type: 'recap', channelId: channel.id, stop: true, by: user.id });
      return { show: null };
    }
    const year = Number(body.year), card = String(body.card ?? '');
    if (!(year >= 2000 && year <= 2100)) throw fail(400, 'Pick a year');
    if (!/^[a-z-]+$/.test(card) || card.length > MAX_CARD) throw fail(400, 'No such card');
    const s = db.prepare('SELECT kind FROM servers WHERE id = ?').get(channel.serverId) as { kind: string } | undefined;
    if (s?.kind !== 'burrow') throw fail(400, 'Only a hearth has a year to look back on.');
    const show: Show = { serverId: channel.serverId, year, card, by: user.id, at: clock() };
    shows.set(channel.id, show);
    ctx.broadcastToChannel(channel as never, { type: 'recap', channelId: channel.id, ...show });
    return { show };
  });
}
