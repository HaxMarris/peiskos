// Screens and speed: opens the web app in Chromium against a small demo hearth on a local server,
// at computer and phone size, light and dark, and fails the check when a screen breaks.
//
// A screen breaks when it throws an error, scrolls sideways on a phone, or has a serious
// accessibility problem (axe-core: missing names, colour contrast and the like). Every screen is
// saved as a picture in the run's "screens" artifact, to look over on a PR that changes the look.
//
// Speed: a cold open on a throttled connection and CPU (like a mid-range phone on 4G) has to show a
// room within SPEED_BUDGET_MS, and the first load has to stay under BYTES_BUDGET (compressed).
// When a change honestly needs more, raise the budget here in the same PR, so it's a decision.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const SPEED_BUDGET_MS = 3500; // about 1.8s today
const BYTES_BUDGET = 600_000; // compressed bytes for a cold open; about 415 kB today

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const out = process.env.OUT_DIR ?? 'screens';
mkdirSync(out, { recursive: true });
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const problems = [];
const log = (...a) => console.log(...a);

const call = async (path, body, token, method) => {
  const r = await fetch(base + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' ' + JSON.stringify(j));
  return j;
};

// A small hearth with a few friends and a conversation.
const u = {};
for (const [n, d] of [['maya', 'Maya'], ['theo', 'Theo'], ['ines', 'Inês']]) {
  u[n] = await call('/api/register', { username: n, password: 'demo-pass-123' });
  await call('/api/me', { displayName: d }, u[n].token, 'PATCH');
}
const s = await call('/api/servers', { name: 'The Cabin' }, u.maya.token);
for (const n of ['theo', 'ines']) await call('/api/join', { inviteCode: s.inviteCode }, u[n].token);
const general = s.channels.find((c) => c.kind === 'text').id;
const lines = [
  ['theo', 'Anyone around tonight?'],
  ['ines', 'Yes! Fire at 8? I can bring the **new map**.'],
  ['maya', 'Perfect. I will set it up 🔥'],
  ['theo', 'See you there'],
];
for (const [n, content] of lines) await call(`/api/channels/${general}/messages`, { content }, u[n].token);

const browser = await chromium.launch();
const sizes = {
  computer: { viewport: { width: 1280, height: 800 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

async function open(size, scheme, { loggedIn = true } = {}) {
  const ctx = await browser.newContext({ ...sizes[size], colorScheme: scheme, serviceWorkers: 'block', bypassCSP: true });
  // Logged in and past What's new, so the screens are the everyday ones.
  await ctx.addInitScript(([token, on]) => {
    if (on) localStorage.setItem('token', token);
    localStorage.setItem('whatsNewSeen', '999');
  }, [u.maya.token, loggedIn]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/');
  await page.waitForSelector(loggedIn ? '.line' : '#auth-form', { state: loggedIn ? 'attached' : 'visible', timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

async function check(page, errors, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}.png` });
  for (const e of errors.splice(0)) problems.push(`${name}: error on the page: ${e}`);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (wide > 1) problems.push(`${name}: the page scrolls sideways by ${wide}px`);
  await page.addScriptTag({ content: AXE });
  const found = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`));
  for (const f of found) problems.push(`${name}: accessibility: ${f}`);
  log(`${name}: ${found.length ? found.length + ' accessibility problem(s)' : 'ok'}`);
}

for (const size of Object.keys(sizes)) {
  for (const scheme of ['light', 'dark']) {
    const tag = `${size}-${scheme}`;
    {
      const { ctx, page, errors } = await open(size, scheme, { loggedIn: false });
      await check(page, errors, `${tag}-sign-in`);
      await ctx.close();
    }
    const { ctx, page, errors } = await open(size, scheme);
    await check(page, errors, `${tag}-room`);
    // A phone opens on the list of rooms; the chat is one tap in.
    if (size === 'phone') {
      await page.click('#channel-list li');
      await check(page, errors, `${tag}-chat`);
    }
    await page.evaluate(() => window.openHome?.());
    await check(page, errors, `${tag}-home`);
    await page.evaluate(() => window.openAccount('settings'));
    await check(page, errors, `${tag}-settings`);
    await page.keyboard.press('Escape');
    await ctx.close();
  }
}

// Speed: a first visit, nothing cached, on a 4G-like connection (9 Mbit/s, 150 ms) and a CPU four times slower.
{
  const ctx = await browser.newContext({ ...sizes.phone, serviceWorkers: 'block' });
  await ctx.addInitScript((token) => { localStorage.setItem('token', token); localStorage.setItem('whatsNewSeen', '999'); }, u.maya.token);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
  const started = Date.now();
  await page.goto(base + '/');
  await page.waitForSelector('.line', { state: 'attached', timeout: 30000 });
  const ms = Date.now() - started;
  await page.waitForTimeout(1500); // what loads just after (pictures, emoji)
  log(`speed: a room showed after ${ms} ms (budget ${SPEED_BUDGET_MS}); ${Math.round(bytes / 1000)} kB loaded (budget ${BYTES_BUDGET / 1000})`);
  if (ms > SPEED_BUDGET_MS) problems.push(`speed: a cold open took ${ms} ms, over the ${SPEED_BUDGET_MS} ms budget`);
  if (bytes > BYTES_BUDGET) problems.push(`speed: a cold open loaded ${bytes} bytes, over the ${BYTES_BUDGET} budget`);
  await ctx.close();
}

await browser.close();
writeFileSync(`${out}/problems.txt`, problems.join('\n') + '\n');
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n` + problems.map((p) => '  ' + p).join('\n'));
  process.exit(1);
}
console.log('\nAll screens and the speed budget are fine.');
