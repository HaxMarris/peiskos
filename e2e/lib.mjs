// What every end-to-end test of the fire's games uses: a Peiskos server of its own, a hearth of
// friends, and one Chromium window per friend, each sitting at the same fire.
//
// Everything is the real thing (server, web app, game pages, the messages between them) except
// the voice call: there is no LiveKit server here, so the call itself connects to nothing.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** Starts a Peiskos server on a free port with an empty database. `env` adds settings (CASINO_… and the like). */
export async function startServer(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'peiskos-e2e-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let log = '';
  const child = spawn(process.execPath, ['--no-warnings', 'src/index.ts'], {
    cwd: join(root, 'server'),
    env: {
      ...process.env, PORT: String(port), DB_FILE: join(dir, 'e2e.db'), UPLOAD_DIR: join(dir, 'uploads'), BACKUP_DIR: join(dir, 'backups'),
      // Fires need voice switched on; the keys only sign tokens nobody checks.
      LIVEKIT_API_KEY: 'e2e-key', LIVEKIT_API_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e', ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const stop = async () => {
    if (child.exitCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); }
    rmSync(dir, { recursive: true, force: true });
  };
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) break;
    try { if ((await fetch(`${base}/api/config`)).ok) return { base, stop, log: () => log }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  await stop();
  throw new Error(`The server didn't start:\n${log}`);
}

/** One request to the server's API, as `token`'s owner. */
export async function call(base, path, { body, token, method } = {}) {
  const r = await fetch(base + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method ?? (body ? 'POST' : 'GET')} ${path}: ${r.status} ${JSON.stringify(j)}`);
  return j;
}

let serial = 0;
/** A hearth with a fire, and the named friends in it. The first one made it. */
export async function makeHearth(base, names) {
  const tag = (++serial).toString(36) + Date.now().toString(36).slice(-4);
  const people = [];
  for (const name of names) {
    const u = await call(base, '/api/register', { body: { username: `${name.toLowerCase()}_${tag}`, password: 'e2e-pass-12345' } });
    await call(base, '/api/me', { body: { displayName: name }, token: u.token, method: 'PATCH' });
    people.push({ name, token: u.token, id: u.user.id });
  }
  const hearth = await call(base, '/api/servers', { body: { name: `Cabin ${tag}` }, token: people[0].token });
  for (const p of people.slice(1)) await call(base, '/api/join', { body: { inviteCode: hearth.inviteCode }, token: p.token });
  const fire = hearth.channels.find((c) => c.kind === 'voice')
    ?? (await call(base, `/api/servers/${hearth.id}/channels`, { body: { name: 'Campfire', kind: 'voice' }, token: people[0].token })).channels.find((c) => c.kind === 'voice');
  return { id: hearth.id, fireId: fire.id, people };
}

let browser = null;
export async function launch() { return (browser ??= await chromium.launch()); }
export async function closeBrowser() { await browser?.close(); browser = null; }

// The voice library loads as usual, but its Room never dials out: joining, the microphone and
// sending data all "work" at once, with nobody else in the call. Peiskos's own server still seats
// everyone at the fire, which is all the games go by.
const QUIET_CALL = () => {
  let real;
  Object.defineProperty(window, 'LivekitClient', {
    configurable: true,
    get: () => real,
    // The library fills its object in after handing it over, so Room is wrapped when first asked for.
    set(lib) {
      const ok = async () => {};
      let Room;
      const quiet = () => (Room ??= class extends lib.Room {
        constructor(...a) {
          super(...a);
          Object.assign(this, { connect: ok, disconnect: ok, startAudio: ok, setE2EEEnabled: ok });
          Object.assign(this.localParticipant, { setMicrophoneEnabled: ok, setCameraEnabled: ok, setScreenShareEnabled: ok, publishData: ok });
        }
      });
      real = new Proxy(lib, { get: (t, k) => (k === 'Room' ? quiet() : t[k]) });
    },
  });
};

/**
 * Opens Peiskos as one of the hearth's people and sits them down at its fire.
 * Returns { page, ctx, errors, game() } where game() is the game's frame once one is open.
 */
export async function sitDown(base, hearth, person, { phone = false } = {}) {
  const b = await launch();
  const ctx = await b.newContext({
    ...(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } }),
    serviceWorkers: 'block',
    permissions: ['microphone'],
  });
  await ctx.addInitScript(([token]) => {
    try {
      localStorage.setItem('token', token);
      localStorage.setItem('whatsNewSeen', '999');
    } catch { /* a blank page on the way in has no storage */ }
  }, [person.token]);
  await ctx.addInitScript(QUIET_CALL);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${person.name}: ${e.message}`));
  await page.goto(base + '/');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.me && state.ws?.readyState === 1, null, { timeout: 20000 });
  await page.evaluate((id) => joinVoice(id), hearth.fireId);
  await page.waitForFunction((id) => state.voice?.channelId === id && state.voice.connected, hearth.fireId, { timeout: 20000 });
  return {
    ...person, page, ctx, errors,
    /** The game's own page, framed on the fire's stage. */
    game: () => page.frameLocator('#game-frame iframe'),
    /** Moves this window's clock on (the host's copy of a game keeps its time). */
    wait: (seconds) => page.clock.fastForward(Math.round(seconds * 1000)),
    /** What Peiskos last told them in a toast. */
    toast: () => page.locator('.toast').last(),
  };
}

/** A hearth, and each of the named friends at its fire in a window of their own. Closed when the test ends. */
export async function fireWith(t, base, names, { phone = [] } = {}) {
  const hearth = await makeHearth(base, names);
  const seats = [];
  t.after(async () => {
    // A failed test leaves a picture of what each friend was looking at.
    if (!t.passed) {
      const dir = process.env.E2E_FAILURES ?? join(import.meta.dirname, 'failures');
      mkdirSync(dir, { recursive: true });
      const slug = t.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
      for (const s of seats) await s.page.screenshot({ path: join(dir, `${slug}--${s.name}.png`) }).catch(() => {});
    }
    for (const s of seats) await s.ctx.close().catch(() => {});
  });
  for (const p of hearth.people) seats.push(await sitDown(base, hearth, p, { phone: phone.includes(p.name) }));
  return { hearth, seats };
}

/** Starts a game from the picker, as the fire's stage shows it. The window's clock can be moved on from here. */
export async function startGame(seat, name) {
  await seat.page.clock.install();
  await seat.page.click('#fire-game');
  await seat.page.click(`#modal-card [data-game="${name}"]`);
  await seat.page.locator('#game-frame iframe').waitFor();
}

/** Joins the game going at the fire, from the fire's game bar. */
export async function joinGame(seat) {
  await seat.page.locator('#game-panel-open').click();
  await seat.page.locator('#game-frame iframe').waitFor();
}

/** Leaves the game from the fire's game bar (for the host that ends it for everyone). */
export async function leaveGame(seat) {
  const back = seat.page.locator('#game-view-back');
  if (await back.isVisible()) await back.click();
  await seat.page.locator('#game-panel-leave').click();
}

/** Waits until `fn` gives something truthy (a page catching up with the others), and hands it back. */
export async function until(fn, what = 'it', timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (err) { last = err; }
    if (Date.now() > end) throw new Error(`Waited ${timeout / 1000}s for ${what}; last saw: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Waits for a locator's text to be (or, for a RegExp, to match) `want`. */
export async function sees(locator, want, timeout = 10000) {
  const norm = (x) => x.replace(/\s+/g, ' ').trim();
  let got = '';
  try {
    await until(async () => {
      got = norm((await locator.evaluateAll((els) => els.map((e) => e.innerText ?? e.textContent))).join(' | '));
      return want instanceof RegExp ? want.test(got) : got.includes(want);
    }, 'text', timeout);
  } catch {
    throw new Error(`Expected to see ${want instanceof RegExp ? want : JSON.stringify(want)}, but saw ${JSON.stringify(got)}`);
  }
  return got;
}

/** No page threw an error while the test ran. */
export function noErrors(seats) {
  const all = seats.flatMap((s) => s.errors);
  if (all.length) throw new Error(`Errors on the page:\n  ${all.join('\n  ')}`);
}
