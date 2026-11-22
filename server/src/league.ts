// The hearth league: a season of points each calendar month (Eastern time, like the fishing board),
// from games at the fire, the weekly fishing derby and the casino. The month's last day is
// championship night, when points count double. Once a month is over, whoever has the most points
// is that season's champion: a trophy on their profile, and their name on a banner at the hearth's
// fires through the next season.
//
// Party games run in the host's app, so the host's copy says who won, the same way fishing catches
// are trusted. What keeps that honest enough among friends: only the host of a game that's going
// can send its result, everyone in it has to be in the game, it takes two people, a fire sends one
// result a minute at most, and each source has a daily cap.
import type { Db } from './db.ts';
import { boardDay, easternMidnight } from './fishing.ts';
import type { Json } from './http.ts';

export type LeagueSource = 'games' | 'fishing' | 'casino';

/** Points a day, per person, before championship night doubles them. */
export const DAILY_CAP: Record<LeagueSource, number> = { games: 40, fishing: 20, casino: 10 };
/** A game's places: first, second, then everyone else who played. All tied (or a game with no winner) is 1 each. */
export const GAME_POINTS = [3, 2, 1];
/** The derby's places, then everyone else who entered. */
export const DERBY_POINTS = [10, 6, 4, 2];
/** A fire's games send a result this often at most. */
const RESULT_GAP_MS = 60_000;

const monthOf = (t: number) => boardDay(t).slice(0, 7);
const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
/** When a month's season ends: midnight Eastern as the next month starts. */
export const seasonEnds = (month: string) => easternMidnight(`${nextMonth(month)}-01`);
/** The last day of the month, Eastern: championship night. */
export const isFinalNight = (t: number) => monthOf(t) !== monthOf(easternMidnight(boardDay(t)) + 36 * 3600e3);

export interface LeagueContext {
  db: Db;
  route: (method: string, path: string, handler: (c: { user: { id: number }; params: string[]; body: Json }) => unknown) => void;
  fail: (status: number, message: string) => Error;
  isMember: (serverId: number, userId: number) => boolean;
  isBurrow: (serverId: number) => boolean;
  can: (serverId: number, userId: number, perm: 'burrow') => boolean;
  channelById: (id: number) => { serverId: number } | undefined;
  sendServerUpdate: (serverId: number) => void;
  now?: () => number;
}

type Season = { month: string; number: number; championId: number | null; championPoints: number | null; settled: number };

export function league(ctx: LeagueContext) {
  const { db, route, fail } = ctx;
  const now = ctx.now ?? Date.now;
  const lastResult = new Map<number, number>(); // fire -> when its last game result came in

  const isOn = (h: number) => ctx.isBurrow(h) && !(db.prepare('SELECT league_off FROM servers WHERE id = ?').get(h) as { league_off: number } | undefined)?.league_off;
  const seasonAt = (h: number, month: string) =>
    db.prepare('SELECT month, number, champion_id AS championId, champion_points AS championPoints, settled FROM league_seasons WHERE server_id = ? AND month = ?').get(h, month) as Season | undefined;
  const totals = (h: number, month: string) =>
    db.prepare(
      `SELECT user_id AS userId, SUM(points) AS points,
              SUM(CASE WHEN source = 'games' THEN points ELSE 0 END) AS games,
              SUM(CASE WHEN source = 'fishing' THEN points ELSE 0 END) AS fishing,
              SUM(CASE WHEN source = 'casino' THEN points ELSE 0 END) AS casino,
              MAX(at) AS lastAt
       FROM league_points WHERE server_id = ? AND month = ? GROUP BY user_id
       ORDER BY points DESC, lastAt ASC`,
    ).all(h, month) as { userId: number; points: number; games: number; fishing: number; casino: number; lastAt: number }[];

  /**
   * Finishes every season that's over: the most points wins, and a tie goes to whoever got there
   * first. Returns whether anything changed, so the hearth's banner can be redrawn.
   */
  const settle = (h: number) => {
    const open = db.prepare('SELECT month FROM league_seasons WHERE server_id = ? AND settled = 0 AND month < ?').all(h, monthOf(now())) as { month: string }[];
    for (const { month } of open) {
      const top = totals(h, month)[0];
      db.prepare('UPDATE league_seasons SET settled = 1, champion_id = ?, champion_points = ? WHERE server_id = ? AND month = ?')
        .run(top?.userId ?? null, top?.points ?? null, h, month);
    }
    return open.length > 0;
  };

  /** This month's season, numbered on from the last one the hearth had (a month nobody scored in isn't one). */
  const openSeason = (h: number, month: string) => {
    if (!seasonAt(h, month)) {
      const last = db.prepare('SELECT MAX(number) AS n FROM league_seasons WHERE server_id = ?').get(h) as { n: number | null };
      db.prepare('INSERT OR IGNORE INTO league_seasons (server_id, month, number) VALUES (?, ?, ?)').run(h, month, (last.n ?? 0) + 1);
    }
    return seasonAt(h, month)!;
  };

  /** Gives someone points, up to the day's cap for that source. Championship night doubles what counts. */
  const award = (h: number, userId: number, source: LeagueSource, what: string, points: number) => {
    if (points <= 0 || !isOn(h) || !ctx.isMember(h, userId)) return 0;
    const t = now();
    const day = boardDay(t);
    if (settle(h)) ctx.sendServerUpdate(h);
    const month = monthOf(t);
    openSeason(h, month);
    // The cap counts points before doubling, so championship night can't be used to go past it.
    const today = db.prepare('SELECT COALESCE(SUM(base), 0) AS n FROM league_points WHERE server_id = ? AND user_id = ? AND source = ? AND day = ?').get(h, userId, source, day) as { n: number };
    const base = Math.min(points, DAILY_CAP[source] - today.n);
    if (base <= 0) return 0;
    const got = isFinalNight(t) ? base * 2 : base;
    db.prepare('INSERT INTO league_points (server_id, month, user_id, source, what, base, points, day, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(h, month, userId, source, what, base, got, day, t);
    return got;
  };

  /** The champion whose banner is up now: the last season that's finished. */
  const champion = (h: number) => {
    const s = db.prepare('SELECT month, number, champion_id AS championId, champion_points AS championPoints FROM league_seasons WHERE server_id = ? AND settled = 1 AND champion_id IS NOT NULL ORDER BY month DESC LIMIT 1').get(h) as
      { month: string; number: number; championId: number; championPoints: number } | undefined;
    return s ? { userId: s.championId, season: s.number, month: s.month, points: s.championPoints } : null;
  };

  const hearth = (raw: string, userId: number) => {
    const h = Number(raw);
    if (!ctx.isBurrow(h) || !ctx.isMember(h, userId)) throw fail(404, "That hearth is gone, or you're not in it.");
    return h;
  };

  route('GET', '/api/servers/:id/league', ({ user, params }) => {
    const h = hearth(params[0], user.id);
    if (settle(h)) ctx.sendServerUpdate(h);
    const t = now();
    const month = monthOf(t);
    const current = seasonAt(h, month);
    const last = db.prepare('SELECT MAX(number) AS n FROM league_seasons WHERE server_id = ? AND month < ?').get(h, month) as { n: number | null };
    const past = db.prepare('SELECT month, number, champion_id AS championId, champion_points AS points FROM league_seasons WHERE server_id = ? AND settled = 1 ORDER BY month DESC LIMIT 24').all(h);
    return {
      on: isOn(h),
      canChange: ctx.can(h, user.id, 'burrow'),
      season: { number: current?.number ?? (last.n ?? 0) + 1, month, endsAt: seasonEnds(month), finalNight: isFinalNight(t), finalAt: easternMidnight(boardDay(seasonEnds(month) - 1)) },
      standings: totals(h, month).map(({ lastAt: _, ...r }) => r),
      past,
      rules: { games: GAME_POINTS, derby: DERBY_POINTS, cap: DAILY_CAP },
    };
  });

  route('PUT', '/api/servers/:id/league', ({ user, params, body }) => {
    const h = hearth(params[0], user.id);
    if (!ctx.can(h, user.id, 'burrow')) throw fail(403, 'Only people who can change the hearth can turn the league on or off.');
    db.prepare('UPDATE servers SET league_off = ? WHERE id = ?').run(body.on === false ? 1 : 0, h);
    ctx.sendServerUpdate(h);
    return { on: isOn(h) };
  });

  return {
    /** What every member's copy of the hearth carries: whether the league is on, and the banner's champion. */
    summary: (h: number) => {
      if (!ctx.isBurrow(h)) return null;
      settle(h);
      return { on: isOn(h), champion: champion(h), finalNight: isFinalNight(now()) };
    },

    /** Seasons someone won, in the hearths the viewer is in too. */
    trophies: (userId: number, viewerId: number) =>
      (db.prepare(
        `SELECT s.server_id AS serverId, v.name AS hearth, s.number AS season, s.month, s.champion_points AS points
         FROM league_seasons s JOIN servers v ON v.id = s.server_id JOIN members m ON m.server_id = s.server_id AND m.user_id = ?
         WHERE s.champion_id = ? AND s.settled = 1 AND v.kind = 'burrow' ORDER BY s.month DESC`,
      ).all(viewerId, userId) as Json[]),

    /**
     * A party game's host says how it went: each player's score, higher is better. Returns the
     * points given, by person, or null when the result isn't counted.
     */
    gameResult: (channelId: number, game: string, players: Set<number>, raw: unknown) => {
      const h = ctx.channelById(channelId)?.serverId;
      if (h === undefined || !Array.isArray(raw)) return null;
      const scores = new Map<number, number>();
      for (const r of raw.slice(0, 16)) {
        const id = Number((r as Json)?.id), score = Number((r as Json)?.score);
        if (players.has(id) && Number.isFinite(score)) scores.set(id, score);
      }
      if (scores.size < 2) return null;
      const t = now();
      if (t - (lastResult.get(channelId) ?? -Infinity) < RESULT_GAP_MS) return null;
      lastResult.set(channelId, t);
      // Places with ties: two people level on top are both first.
      const levels = [...new Set(scores.values())].sort((a, b) => b - a);
      const out: Record<number, number> = {};
      for (const [id, score] of scores) {
        const place = levels.length === 1 ? GAME_POINTS.length - 1 : Math.min(levels.indexOf(score), GAME_POINTS.length - 1);
        out[id] = award(h, id, 'games', game, GAME_POINTS[place]);
      }
      return out;
    },

    /** A derby week's places, once it's settled: first is 1. */
    derbyPlaced: (h: number, places: { userId: number; place: number }[]) => {
      for (const { userId, place } of places) award(h, userId, 'fishing', 'derby', DERBY_POINTS[Math.min(place, DERBY_POINTS.length) - 1]);
    },

    /** A win at the casino: a hand, a spin that paid more than it cost, a pot, a battle. */
    casinoWin: (h: number, userId: number, what: string) => award(h, userId, 'casino', what, 1),
  };
}
