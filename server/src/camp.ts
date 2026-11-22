// The camp grows: what a hearth's people do together builds up its camp on the hearth map. Hours
// at the fires, games played together and fish caught add up to camp points, and each build
// (a woodpile, a lantern path, a sauna...) goes up at a number of points and stays up. Each season
// also has one shared goal; meeting it leaves a keepsake on the map for good.
//
// Fire hours come from voice_time, which is already kept. Games and fish are logged here as they
// happen (camp_activity). The catches in everyone's Fireside Angler saves when the camp arrived were
// logged once by its migration, so a hearth's fishing from before counts too.
import type { Db } from './db.ts';
import { HttpError, type Json } from './http.ts';
import { BOARD_TIME_ZONE } from './fishing.ts';

type Handler = (ctx: { user: { id: number }; params: string[]; body: Json; url: URL }) => unknown;

/** What gets built, in order, and at how many camp points. client/js/camp.js draws each by its id. */
export const CAMP_BUILDS = [
  { id: 'woodpile', name: 'Woodpile', points: 5 },
  { id: 'lanterns', name: 'Lantern path', points: 15 },
  { id: 'boat', name: 'Rowboat', points: 30 },
  { id: 'cabin', name: 'Guest cabin', points: 50 },
  { id: 'garden', name: 'Garden', points: 80 },
  { id: 'sauna', name: 'Sauna', points: 120 },
  { id: 'tower', name: 'Lookout tower', points: 175 },
  { id: 'flag', name: 'Hearth flag', points: 250 },
] as const;

/** One camp point is an hour at a fire (anyone's), a game played together, or this many fish. */
export const FISH_PER_POINT = 20;
// A save can only add this many catches: the game saves every second or so, so a save that claims
// a thousand new fish is a broken or edited one. (Saves are trusted as far as that, like the board.)
const MAX_FISH_PER_SAVE = 20;
// A game counts once two people have played it for this long.
export const GAME_MIN_MS = 60_000;

type Measure = 'hours' | 'games' | 'fish';
/** Each season's shared goal: what it counts, and how much per person in the hearth. Its keepsake is drawn by its key. */
export const SEASONS = {
  winter: { name: 'Winter', measure: 'hours', perPerson: 5, counts: 'hours at the fire', keepsake: 'Snowman' },
  spring: { name: 'Spring', measure: 'games', perPerson: 3, counts: 'games played together', keepsake: 'Flower bed' },
  summer: { name: 'Summer', measure: 'fish', perPerson: 100, counts: 'fish caught', keepsake: 'Beach umbrella' },
  autumn: { name: 'Autumn', measure: 'hours', perPerson: 5, counts: 'hours at the fire', keepsake: 'Pumpkin patch' },
} as const satisfies Record<string, { name: string; measure: Measure; perPerson: number; counts: string; keepsake: string }>;
type SeasonKey = keyof typeof SEASONS;

const HOUR = 3600_000;

/** Midnight at the start of a month, in the fishing board's time zone (Eastern), as a timestamp. */
export function monthStart(year: number, month: number, timeZone = BOARD_TIME_ZONE) {
  // Month is 1-12 and may run past 12. Guess UTC midnight, then move by the zone's offset there.
  const guess = Date.UTC(year, month - 1, 1);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(guess).map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return guess - (wall - guess);
}

/** The season a moment falls in: winter is December to February, and is named for its December's year. */
export function seasonOf(t: number) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: BOARD_TIME_ZONE, year: 'numeric', month: 'numeric' }).format(t).split('-').map(Number);
  const key: SeasonKey = m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
  const year = m <= 2 ? y - 1 : y;
  const first = { winter: 12, spring: 3, summer: 6, autumn: 9 }[key];
  return { id: `${year}-${key}`, key, year, start: monthStart(year, first), end: monthStart(year, first + 3) };
}

export type CampContext = {
  db: Db;
  route: (method: string, path: string, handler: Handler) => void;
  isMember: (serverId: number, userId: number) => boolean;
  serverMemberIds: (serverId: number) => number[];
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  /** The hearths someone is at a fire in right now, which are the ones whose points are going up. */
  busyHearths: () => Iterable<number>;
  now?: () => number;
};

export function camp(ctx: CampContext) {
  const { db, route } = ctx;
  const now = ctx.now ?? Date.now;

  const isHearth = (serverId: number) => !!db.prepare("SELECT 1 FROM servers WHERE id = ? AND kind = 'burrow'").get(serverId);

  // Time at a hearth's AFK fire doesn't count, as with the other fire hours.
  const hours = (serverId: number, from = 0, to = Number.MAX_SAFE_INTEGER) =>
    (db.prepare(
      `SELECT COALESCE(SUM(MIN(ended_at, ?) - MAX(started_at, ?)), 0) AS ms FROM voice_time
       WHERE server_id = ? AND ended_at > ? AND started_at < ?
         AND channel_id IS NOT (SELECT afk_channel_id FROM servers WHERE id = voice_time.server_id)`,
    ).get(to, from, serverId, from, to) as { ms: number }).ms / HOUR;
  const logged = (serverId: number, kind: 'game' | 'fish', from = 0, to = Number.MAX_SAFE_INTEGER) =>
    (db.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM camp_activity WHERE server_id = ? AND kind = ? AND at >= ? AND at < ?').get(serverId, kind, from, to) as { n: number }).n;
  const people = (serverId: number) =>
    (db.prepare('SELECT COUNT(*) AS n FROM members m JOIN users u ON u.id = m.user_id WHERE m.server_id = ? AND u.bot = 0 AND u.deleted_at IS NULL').get(serverId) as { n: number }).n;

  /** This season's goal for a hearth, set the first time it's asked for so it doesn't move as people come and go. */
  const seasonRow = (serverId: number, t: number) => {
    const s = seasonOf(t);
    const def = SEASONS[s.key];
    db.prepare('INSERT OR IGNORE INTO camp_seasons (server_id, season, goal) VALUES (?, ?, ?)')
      .run(serverId, s.id, def.perPerson * Math.min(12, Math.max(2, people(serverId))));
    const row = db.prepare('SELECT goal, met_at AS metAt FROM camp_seasons WHERE server_id = ? AND season = ?').get(serverId, s.id) as { goal: number; metAt: number | null };
    const done = def.measure === 'hours' ? hours(serverId, s.start, s.end) : logged(serverId, def.measure === 'games' ? 'game' : 'fish', s.start, s.end);
    return { ...s, ...def, goal: row.goal, metAt: row.metAt, done: Math.floor(done * 10) / 10 };
  };

  /** Everything the map and the camp panel show. */
  const view = (serverId: number) => {
    const t = now();
    const fire = hours(serverId), games = logged(serverId, 'game'), fish = logged(serverId, 'fish');
    const points = Math.floor(fire + games + fish / FISH_PER_POINT);
    const stage = (db.prepare('SELECT camp_stage FROM servers WHERE id = ?').get(serverId) as { camp_stage: number }).camp_stage;
    const season = seasonRow(serverId, t);
    const keepsakes = (db.prepare('SELECT season, met_at AS metAt FROM camp_seasons WHERE server_id = ? AND met_at IS NOT NULL ORDER BY met_at').all(serverId) as { season: string; metAt: number }[])
      .map((k) => { const key = k.season.split('-')[1] as SeasonKey; return { season: k.season, key, name: `${SEASONS[key]?.name ?? ''} ${k.season.split('-')[0]}`, keepsake: SEASONS[key]?.keepsake ?? '', metAt: k.metAt }; })
      .filter((k) => k.keepsake);
    return {
      serverId,
      points,
      from: { hours: Math.floor(fire * 10) / 10, games, fish },
      // A build stays up once it's built, even if the points behind it later go (someone leaves and their time goes with them).
      builds: CAMP_BUILDS.map((b, i) => ({ ...b, built: i < stage || points >= b.points })),
      season: { id: season.id, key: season.key, name: `${season.name} ${season.year}`, goal: season.goal, counts: season.counts, done: season.done, met: season.metAt !== null, keepsake: season.keepsake, ends: season.end },
      keepsakes,
    };
  };

  /**
   * Builds whatever the points now reach and marks this season's goal met when it is, telling the
   * hearth's people about anything new.
   */
  const check = (serverId: number) => {
    if (!isHearth(serverId)) return null;
    const v = view(serverId);
    const was = (db.prepare('SELECT camp_stage FROM servers WHERE id = ?').get(serverId) as { camp_stage: number }).camp_stage;
    const stage = v.builds.filter((b) => b.built).length;
    const built = v.builds.slice(was, stage).map((b) => b.name);
    if (stage > was) db.prepare('UPDATE servers SET camp_stage = ? WHERE id = ?').run(stage, serverId);
    let met: string | null = null;
    if (!v.season.met && v.season.done >= v.season.goal) {
      const r = db.prepare('UPDATE camp_seasons SET met_at = ? WHERE server_id = ? AND season = ? AND met_at IS NULL').run(now(), serverId, v.season.id);
      if (r.changes) met = v.season.name;
    }
    if (!built.length && !met) return v;
    const fresh = view(serverId);
    ctx.sendTo(ctx.serverMemberIds(serverId), { type: 'camp', serverId, camp: fresh, built, met });
    return fresh;
  };

  route('GET', '/api/servers/:id/camp', ({ user, params }) => {
    const serverId = Number(params[0]);
    if (!ctx.isMember(serverId, user.id) || !isHearth(serverId)) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    return check(serverId);
  });

  // Fire hours go up by the minute, so the hearths with someone at a fire are checked now and then.
  const timer = setInterval(() => {
    for (const id of new Set(ctx.busyHearths())) check(id);
  }, 5 * 60_000);
  timer.unref();

  return {
    check,
    /** A game at a fire ended. It counts when at least two people played it for a minute. */
    gameEnded(serverId: number, players: number, ms: number) {
      if (players < 2 || ms < GAME_MIN_MS || !isHearth(serverId)) return;
      db.prepare("INSERT INTO camp_activity (server_id, kind, n, at) VALUES (?, 'game', 1, ?)").run(serverId, now());
      check(serverId);
    },
    /** A Fireside Angler save came in: whatever it adds to the catch count goes to the camp. */
    fishSaved(serverId: number, before: unknown, after: unknown) {
      const caught = (save: unknown) => Number((save as { stats?: { caught?: unknown } } | null)?.stats?.caught) || 0;
      const n = Math.floor(Math.min(MAX_FISH_PER_SAVE, caught(after) - caught(before)));
      if (!(n > 0) || !isHearth(serverId)) return;
      db.prepare("INSERT INTO camp_activity (server_id, kind, n, at) VALUES (?, 'fish', ?, ?)").run(serverId, n, now());
      // A fish is only a twentieth of a point: check when the hearth's count passes a whole point.
      const total = logged(serverId, 'fish');
      if (Math.floor(total / FISH_PER_POINT) !== Math.floor((total - n) / FISH_PER_POINT)) check(serverId);
    },
    stop: () => clearInterval(timer),
  };
}
