// Records the video Google Play asks for about the Android app's foreground service: joining a voice
// room, the call carrying on from the home screen and another app, and Mute/Leave in the notification.
// Runs in the "Play video" workflow against a demo server and voice server on the same machine, with
// two friends already at the fire from a desktop browser.
import { _android, chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const out = process.env.OUT_DIR ?? 'video';
const apk = process.argv[2];
mkdirSync(out, { recursive: true });
const base = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 30000 });

// If anything gets stuck, say where, with the phone's recent log, instead of waiting for the job to time out.
setTimeout(() => {
  log('STUCK, phone log:');
  try { console.log(execFileSync('adb', ['logcat', '-d', '-t', '150'], { encoding: 'utf8', timeout: 20000 })); } catch (e) { log('no phone log:', e.message); }
  process.exit(2);
}, 6 * 60 * 1000).unref();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

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

// A small demo hearth.
const people = [['maya', 'Maya'], ['theo', 'Theo'], ['ines', 'Inês'], ['jonas', 'Jonas']];
const u = {};
for (const [n, d] of people) {
  u[n] = await call('/api/register', { username: n, password: 'demo-pass-123', email: `${n}@example.com` });
  await call('/api/me', { displayName: d }, u[n].token, 'PATCH');
}
const s = await call('/api/servers', { name: 'The Cabin' }, u.maya.token);
for (const n of ['theo', 'ines', 'jonas']) await call('/api/join', { inviteCode: s.inviteCode }, u[n].token);
await call(`/api/servers/${s.id}/channels`, { name: 'Campfire', kind: 'voice' }, u.maya.token);
const general = s.channels.find((c) => c.kind === 'text').id;
await call(`/api/channels/${general}/messages`, { content: 'fire is lit, come hang out' }, u.theo.token);
log('seeded');

// Friends already at the fire, from a desktop browser with a fake microphone.
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
for (const n of ['theo', 'ines']) {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && log(n, 'console:', m.text()));
  await p.goto(base);
  await p.evaluate((t) => localStorage.setItem('token', t), u[n].token);
  await p.goto(base);
  await p.locator('li.fire-card').first().click({ timeout: 20000 });
  await sleep(3000);
  log(n, 'joined the fire');
}

// The phone.
for (const port of [3000, 7880, 7881]) adb('reverse', `tcp:${port}`, `tcp:${port}`);
// A slow emulator's launcher can trip Android's "isn't responding" box; keep those off the video.
try { adb('shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1'); } catch (e) { log('error dialogs', e.message); }
// A smaller screen is much less work for the emulator's software graphics.
adb('shell', 'wm', 'size', '720x1600');
adb('shell', 'wm', 'density', '300');
log('installing');
adb('install', '-r', '-g', apk);
for (const perm of ['RECORD_AUDIO', 'POST_NOTIFICATIONS']) {
  try { adb('shell', 'pm', 'grant', 'app.peiskos', `android.permission.${perm}`); } catch (e) { log('grant', perm, e.message); }
}
adb('shell', 'am', 'start', '-n', 'app.peiskos/.MainActivity');
await sleep(6000);

const shots = [];
const shot = (name) => {
  try {
    writeFileSync(`${out}/${name}.png`, execFileSync('adb', ['exec-out', 'screencap', '-p'], { timeout: 30000 }));
    shots.push(name);
    log('screenshot', name);
  } catch (e) {
    log('screenshot', name, 'failed:', e.message);
  }
};

log('connecting to the app');
const within = (ms, what, promise) => Promise.race([promise, sleep(ms).then(() => { throw new Error(`${what} took too long`); })]);
const [device] = await within(30000, 'finding the phone', _android.devices());
const appPage = async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      const webview = await within(45000, 'finding the app', device.webView({ pkg: 'app.peiskos' }));
      return await within(30000, 'opening the app page', webview.page());
    } catch (e) {
      log(`attempt ${attempt}:`, e.message);
      if (attempt === 3) throw e;
      adb('shell', 'am', 'force-stop', 'app.peiskos');
      adb('shell', 'am', 'start', '-n', 'app.peiskos/.MainActivity');
      await sleep(8000);
    }
  }
};
let page = await appPage();
log('signing in');
await within(30000, 'signing in', page.evaluate((t) => {
  localStorage.setItem('serverUrl', 'http://localhost:3000');
  localStorage.setItem('token', t);
  localStorage.setItem('theme', 'light');
  setTimeout(() => location.reload(), 100);
}, u.maya.token));
await sleep(7000);
page = await appPage();
log('signed in');
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && log('app console:', m.type(), m.text()));
shot('1-app');

// Find something on screen by its label and tap it. Returns false when it isn't there.
const tap = (label, required = true) => {
  adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
  const xml = adb('shell', 'cat', '/sdcard/ui.xml');
  const re = new RegExp(`text="${label}"[^>]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i');
  const m = xml.match(re);
  if (!m) {
    if (!required) return false;
    writeFileSync(`${out}/ui-${label}.xml`, xml);
    throw new Error(`no "${label}" button on screen`);
  }
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  adb('shell', 'input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1));
  log('tapped', label);
  return true;
};
// The emulator's launcher is slow enough to trip Android's "isn't responding" box now and then.
const dismissHang = () => { try { tap('Wait', false); } catch (e) { log('checking for a hang box:', e.message); } };

dismissHang();
log('recording');
const rec = spawn('adb', ['shell', 'screenrecord', '--bit-rate', '8000000', '/sdcard/demo.mp4'], { stdio: 'inherit' });
await sleep(2500);

try {
  dismissHang();
  log('joining');
  await page.locator('li.fire-card .voice-room-name').first().click({ timeout: 20000 });
  log('joined');
  await sleep(5000);
  dismissHang();
  await sleep(1000);
  shot('2-fire');

  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  await sleep(2500);
  dismissHang();
  adb('shell', 'cmd', 'statusbar', 'expand-notifications');
  await sleep(4000);
  shot('3-notification');
  adb('shell', 'cmd', 'statusbar', 'collapse');
  await sleep(1000);

  adb('shell', 'am', 'start', '-a', 'android.settings.SETTINGS');
  await sleep(4000);
  dismissHang();
  shot('4-other-app');
  adb('shell', 'cmd', 'statusbar', 'expand-notifications');
  await sleep(2500);

  tap('Mute');
  await sleep(3000);
  shot('5-muted');
  tap('Leave');
  await sleep(2500);
  shot('6-left');
  adb('shell', 'cmd', 'statusbar', 'collapse');
  adb('shell', 'am', 'start', '-n', 'app.peiskos/.MainActivity');
  await sleep(4000);
  shot('7-back');
} catch (e) {
  log('FAILED:', e.message);
  shot('error');
  process.exitCode = 1;
} finally {
  const quiet = (...a) => { try { return adb(...a); } catch (e) { log(a.join(' '), 'failed:', e.message.split('\n')[1] ?? e.message); } };
  quiet('shell', 'pkill', '-INT', 'screenrecord');
  await Promise.race([new Promise((r) => rec.on('exit', r)), sleep(10000)]);
  await sleep(2000);
  quiet('pull', '/sdcard/demo.mp4', `${out}/peiskos-voice-in-background.mp4`);
  writeFileSync(`${out}/shots.txt`, shots.join('\n'));

  // Small previews in the log, so the run can be checked without downloading anything.
  const preview = await (await browser.newContext({ viewport: { width: 270, height: 600 } })).newPage();
  for (const name of shots) {
    const png = readFileSync(`${out}/${name}.png`).toString('base64');
    await preview.setContent(`<body style="margin:0"><img src="data:image/png;base64,${png}" style="width:270px;display:block">`);
    const jpg = await preview.locator('img').screenshot({ type: 'jpeg', quality: 55 });
    console.log(`SHOT ${name} ${jpg.toString('base64')}`);
  }
  await browser.close();
}
