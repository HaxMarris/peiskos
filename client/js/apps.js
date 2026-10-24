// The app itself, on phones, computers and the web: display settings (compact messages, text
// size, less motion), keyboard shortcuts and the quick switcher, screen reader and keyboard
// help, swipes on phones, working offline, installing on Android, sharing into Burrow from
// other apps, and in the desktop app the tray, starting with the computer and several servers.
// Part of Burrow's client: plain scripts that index.html loads in order, sharing one global scope.
'use strict';

// ---------------------------------------------------------------- display settings

const readDisplay = () => { try { return JSON.parse(store.get('display')) || {}; } catch { return {}; } };
function saveDisplay(change) {
  store.set('display', JSON.stringify({ ...readDisplay(), ...change }));
  window.applyDisplay?.();
}

const TEXT_SIZES = [80, 90, 100, 110, 125, 150];
function displaySettings() {
  const d = readDisplay();
  const size = Number(d.textSize) || 100;
  return `<h3>Display</h3>
    <label class="check"><input type="checkbox" id="display-compact" ${d.compact ? 'checked' : ''} /> Compact messages</label>
    <span class="small muted">Tighter lines with small pictures, so more fits on screen.</span>
    <label>Text size
      <select id="display-size">${TEXT_SIZES.map((n) => `<option value="${n}" ${n === size ? 'selected' : ''}>${n}%${n === 100 ? ' (normal)' : ''}</option>`).join('')}</select>
    </label>
    <span class="small muted">Makes everything in Peiskos bigger or smaller${isDesktop ? '. Ctrl+plus and Ctrl+minus work too.' : ', on this device.'}</span>
    <label>Motion
      <select id="display-motion">
        <option value="system" ${!d.motion ? 'selected' : ''}>Follow my system setting</option>
        <option value="reduce" ${d.motion === 'reduce' ? 'selected' : ''}>Less motion</option>
        <option value="full" ${d.motion === 'full' ? 'selected' : ''}>All animations</option>
      </select>
    </label>
    <label class="check"><input type="checkbox" id="display-seasons" ${d.seasons !== 'off' ? 'checked' : ''} /> Seasonal touches</label>
    <span class="small muted">Snow on the fire in winter, falling leaves in autumn, and something extra for the holidays.</span>`;
}
function wireDisplaySettings() {
  $('#display-compact').onchange = (e) => saveDisplay({ compact: e.target.checked });
  $('#display-size').onchange = (e) => saveDisplay({ textSize: Number(e.target.value) });
  $('#display-motion').onchange = (e) => saveDisplay({ motion: e.target.value === 'system' ? undefined : e.target.value });
  $('#display-seasons').onchange = (e) => { saveDisplay({ seasons: e.target.checked ? undefined : 'off' }); seasonLayer(); };
}

// Ctrl+plus, Ctrl+minus and Ctrl+0 in the desktop app (browsers zoom by themselves).
document.addEventListener('keydown', (e) => {
  if (!isDesktop || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  const at = TEXT_SIZES.indexOf(Number(readDisplay().textSize) || 100);
  let next = null;
  if (e.key === '=' || e.key === '+') next = TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, at + 1)];
  else if (e.key === '-') next = TEXT_SIZES[Math.max(0, at - 1)];
  else if (e.key === '0') next = 100;
  if (next == null) return;
  e.preventDefault();
  saveDisplay({ textSize: next });
});

// ---------------------------------------------------------------- the app: install, desktop settings, servers

function appSettings() {
  const desktop = window.burrowDesktop?.settings;
  const d = desktop?.get() ?? {};
  const mac = window.burrowDesktop?.platform === 'darwin';
  return `<h3>App</h3>
    ${desktop ? `<label class="check"><input type="checkbox" id="app-tray" ${d.closeToTray ? 'checked' : ''} /> Keep running in the ${mac ? 'menu bar' : 'tray'} when the window is closed</label>
    <span class="small muted">Messages and voice keep going, and a dot on the icon shows when something's unread. Quit from the icon's menu.</span>
    <label class="check"><input type="checkbox" id="app-login" ${d.openAtLogin ? 'checked' : ''} /> Start Peiskos when the computer starts</label>
    <span class="small muted">It opens quietly in the ${mac ? 'menu bar' : 'tray'}.</span>` : ''}
    ${installPrompt ? '<div><button type="button" class="btn secondary" id="app-install">Install Peiskos on this device</button></div>' : ''}
    <div><button type="button" class="btn secondary" id="app-shortcuts">Keyboard shortcuts</button></div>`;
}
function wireAppSettings() {
  const desktop = window.burrowDesktop?.settings;
  if (desktop) {
    $('#app-tray').onchange = (e) => desktop.set({ closeToTray: e.target.checked });
    $('#app-login').onchange = (e) => desktop.set({ openAtLogin: e.target.checked });
  }
  if ($('#app-install')) $('#app-install').onclick = () => { closeModal(); installApp(); };
  $('#app-shortcuts').onclick = openShortcuts;
}

// Android (and Chrome or Edge on a computer) can install Burrow as an app of its own. The browser
// says when it's possible; then "Install the app" shows in your menu.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('#install-btn').classList.remove('hidden');
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('#install-btn').classList.add('hidden');
  toast('Peiskos is installed. Open it from your home screen or app list.');
});
async function installApp() {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $('#install-btn').classList.add('hidden');
}
$('#install-btn').onclick = installApp;
$('#shortcuts-btn').onclick = () => openShortcuts();

// A newer desktop app: a green button in the top bar, as in Discord, that restarts into it once
// you confirm. (An unsigned Mac build can't install it itself, so the button opens the download.)
const updates = window.burrowDesktop?.update;
function showUpdateButton(update) {
  if (!update) return;
  const btn = $('#update-btn');
  const label = update.install ? `Update to ${update.version}` : `Peiskos ${update.version} is out`;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.classList.remove('hidden');
  btn.onclick = () => {
    modal(`<h2>Update Peiskos?</h2>
      <p class="muted">${update.install
        ? `Version ${escapeHtml(update.version)} is ready. Peiskos closes and opens again in a few seconds. If you're by a fire, you'll need to join it again.`
        : `Version ${escapeHtml(update.version)} is out. Download it and install it over this one.`}</p>
      <div class="modal-row"><span class="spacer"></span><button type="button" class="btn secondary" data-close>Not now</button><button type="button" class="btn" id="update-go">${update.install ? 'Restart and update' : 'Download'}</button></div>`);
    $('#update-go').onclick = () => { closeModal(); updates.install(); };
  };
}
if (updates) {
  showUpdateButton(updates.get());
  updates.onReady(showUpdateButton);
}

// The service worker: alerts while Burrow is closed, the app's files for working offline, and
// things shared from other apps. (Only on the web; the desktop app has its files built in.)
if (!isApp && 'serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---- several servers in the desktop app
//
// Each server you've logged in to is remembered (its address, your login and where you were),
// and switching reloads the app on the other one.

const readAccounts = () => { try { return JSON.parse(store.get('accounts')) || []; } catch { return []; } };
const saveAccounts = (list) => store.set('accounts', JSON.stringify(list));
const sameAccount = (a) => a.url === state.serverUrl && a.username === state.me?.username;

function rememberAccount() {
  if (!isApp || !state.me) return;
  const list = readAccounts();
  const mine = list.find(sameAccount);
  const entry = { url: state.serverUrl, username: state.me.username, token: state.token, avatar: state.me.avatar ?? null, name: state.me.displayName || state.me.username };
  if (mine) Object.assign(mine, entry);
  else list.push(entry);
  saveAccounts(list);
  $('#servers-btn').classList.remove('hidden');
}
function forgetAccount() {
  if (!isApp) return;
  saveAccounts(readAccounts().filter((a) => !(a.url === state.serverUrl && a.token === state.token)));
}

/** Leaves this server for another account (or the login screen, with no account). */
function switchAccount(to) {
  saveSnapshot();
  const list = readAccounts();
  const mine = list.find((a) => a.url === state.serverUrl && a.token === state.token);
  if (mine) mine.local = { lastServer: store.get('lastServer'), lastChannel: store.get('lastChannel'), lastDm: store.get('lastDm'), lastHearth: store.get('lastHearth') };
  saveAccounts(list);
  leaveVoice();
  for (const k of ['lastServer', 'lastChannel', 'lastDm', 'lastHearth']) store.set(k, to?.local?.[k] ?? null);
  store.set('token', to?.token ?? null);
  store.set('serverUrl', to?.url ?? null);
  location.reload();
}

function hostName(url) { try { return new URL(url).host; } catch { return url; } }

function openServers() {
  const list = readAccounts();
  modal(`<h2>Your servers</h2>
    <p class="muted small">Each server is a different host's Peiskos. Switching keeps you logged in to all of them.</p>
    <ul class="server-accounts" id="server-accounts"></ul>
    <div class="modal-row">
      <button type="button" class="btn secondary" data-close>Close</button>
      <button type="button" class="btn" id="add-account">Add a server</button>
    </div>`);
  const rows = list.map((a) => {
    const li = document.createElement('li');
    const here = a.url === state.serverUrl && a.token === state.token;
    const av = document.createElement('span');
    av.className = 'avatar sm';
    setAvatar(av, a.username, null);
    const text = document.createElement('span');
    text.className = 'account-text';
    text.innerHTML = `<strong>${escapeHtml(hostName(a.url))}</strong><span class="small muted">${escapeHtml(a.name)} (@${escapeHtml(a.username)})${here ? ' · open now' : ''}</span>`;
    li.append(av, text);
    if (!here) {
      li.append(Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: 'Switch', onclick: () => switchAccount(a) }));
      li.append(Object.assign(document.createElement('button'), {
        type: 'button', className: 'btn secondary', textContent: 'Remove', title: 'Forget this server on this computer',
        onclick: () => { saveAccounts(readAccounts().filter((x) => x !== a && !(x.url === a.url && x.token === a.token))); li.remove(); },
      }));
    }
    return li;
  });
  $('#server-accounts').replaceChildren(...rows);
  $('#add-account').onclick = () => switchAccount(null);
}
$('#servers-btn').onclick = () => openServers();

// The login screen lists the other servers you're logged in to, to go straight back.
function showAccountsOnLogin() {
  const box = $('#auth-accounts');
  const list = isApp ? readAccounts().filter((a) => a.token) : [];
  box.classList.toggle('hidden', !list.length);
  box.replaceChildren(...(list.length ? [Object.assign(document.createElement('p'), { className: 'muted small center', textContent: 'Or go back to' })] : []),
    ...list.map((a) => Object.assign(document.createElement('button'), {
      type: 'button', className: 'btn secondary', textContent: `${a.name} on ${hostName(a.url)}`, onclick: () => switchAccount(a),
    })));
}

// ---------------------------------------------------------------- the quick switcher (Ctrl+K)

/** Everywhere you can go: rooms and threads in every burrow, conversations, and burrows. */
function switcherPlaces() {
  const places = [];
  for (const id of state.serverOrder) {
    const s = state.servers.get(id);
    if (!s) continue;
    places.push({ kind: 'burrow', label: s.name, sub: 'Hearth', s, go: () => selectServer(s.id) });
    for (const c of s.channels) {
      if (c.kind === 'voice' || c.archived) continue;
      places.push({ kind: 'room', label: c.name, sub: s.name, s, c, go: () => openPlace(s, c) });
    }
    for (const t of s.threads ?? []) places.push({ kind: 'thread', label: t.name, sub: `Thread in ${s.name}`, s, c: t, go: () => openPlace(s, t) });
  }
  for (const id of state.dmOrder) {
    const s = state.servers.get(id);
    const c = s?.channels[0];
    if (c) places.push({ kind: 'dm', label: dmTitle(s), sub: s.group ? 'Group' : 'Direct message', s, c, go: () => openPlace(s, c) });
  }
  return places;
}
async function openPlace(s, c) {
  if (s.id === state.serverId) await selectChannel(c.id);
  else await selectServer(s.id, false, { channelId: c.id });
  showView('chat');
}

/**
 * A search box over a list of places. Arrows move, Enter opens, and with nothing typed the
 * unread ones come first. `pick` gets the chosen place; `only` narrows what's listed.
 */
function openPlacePicker({ title, hint, pick = (p) => p.go(), only = () => true }) {
  modal(`<h2>${escapeHtml(title)}</h2>
    <input id="place-search" class="place-search" placeholder="Where to?" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="place-list" aria-autocomplete="list" />
    <ul id="place-list" class="place-list" role="listbox" aria-label="Places"></ul>
    <p class="small muted">${escapeHtml(hint)}</p>`, 'place-modal');
  const all = switcherPlaces().filter(only);
  const box = $('#place-search');
  let shown = [];
  let at = 0;
  const unread = (p) => (p.c ? isUnread(p.c) : serverUnread(p.s));
  const render = () => {
    const q = box.value.trim().toLowerCase().replace(/^[#@]/, '');
    shown = q
      ? all.filter((p) => p.label.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q))
        .sort((a, b) => b.label.toLowerCase().startsWith(q) - a.label.toLowerCase().startsWith(q) || unread(b) - unread(a))
      : [...all].sort((a, b) => unread(b) - unread(a) || (b.c?.id === state.channelId) - (a.c?.id === state.channelId));
    shown = shown.slice(0, 40);
    at = Math.min(at, Math.max(0, shown.length - 1));
    $('#place-list').replaceChildren(...shown.map((p, i) => {
      const li = document.createElement('li');
      li.id = `place-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === at));
      li.className = (i === at ? 'active' : '') + (unread(p) ? ' unread' : '');
      const mark = p.kind === 'dm' ? '@' : p.kind === 'burrow' ? '' : '#';
      li.innerHTML = `<span class="place-label">${mark}${escapeHtml(p.label)}</span><span class="small muted">${escapeHtml(p.sub)}</span>`;
      li.onclick = () => { closeModal(); pick(p); };
      return li;
    }));
    if (!shown.length) $('#place-list').innerHTML = '<li class="muted small">Nothing matches.</li>';
    box.setAttribute('aria-activedescendant', shown.length ? `place-${at}` : '');
    $(`#place-${at}`)?.scrollIntoView({ block: 'nearest' });
  };
  box.oninput = () => { at = 0; render(); };
  box.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      at = (at + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length);
      render();
    } else if (e.key === 'Enter' && shown[at]) {
      e.preventDefault();
      const p = shown[at];
      closeModal();
      pick(p);
    }
  };
  render();
  box.focus();
}
const openQuickSwitcher = () => openPlacePicker({ title: 'Go to', hint: 'Type part of a room, conversation or hearth. Unread ones come first.' });

// ---------------------------------------------------------------- keyboard shortcuts

const SHORTCUTS = [
  ['Ctrl+K', 'Go to a room, conversation or hearth'],
  ['Ctrl+F', 'Search messages'],
  ['Alt+↑ / Alt+↓', 'Previous or next room'],
  ['Alt+Shift+↑ / ↓', 'Previous or next unread room'],
  ['Esc', 'Close a window or menu, or stop replying'],
  ['↑ in an empty message box', 'Edit your last message'],
  ['Shift+Enter', 'New line in a message'],
  ['Tab', 'Fill in an @mention'],
  ['Ctrl+Shift+M', 'Mute or unmute in voice'],
  ['Ctrl+Shift+D', 'Deafen in voice'],
  ['Ctrl+plus / minus / 0', 'Bigger, smaller or normal text'],
  ['Ctrl+/', 'This list'],
];
function openShortcuts() {
  const mac = /Mac/.test(navigator.platform);
  const key = (k) => (mac ? k.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥') : k);
  modal(`<h2>Keyboard shortcuts</h2>
    <dl class="shortcut-list">${SHORTCUTS.map(([k, what]) => `<dt><kbd>${escapeHtml(key(k))}</kbd></dt><dd>${escapeHtml(what)}</dd>`).join('')}</dl>
    <div class="modal-row"><button type="button" class="btn" data-close>Done</button></div>`);
}

/** The room list as it's shown: rooms, threads and conversations you can click. */
const roomRows = () => [...document.querySelectorAll('#channel-list > li')].filter((li) => li.onclick);
function stepRoom(step, unreadOnly) {
  const rows = roomRows();
  if (!rows.length) return;
  const at = rows.findIndex((li) => li.classList.contains('active'));
  for (let i = 1; i <= rows.length; i++) {
    const li = rows[(at + step * i + rows.length * i) % rows.length];
    if (unreadOnly && !li.classList.contains('unread')) continue;
    li.click();
    // Keep typing where you were, in the new room.
    requestAnimationFrame(() => { if (!isPhone()) $('#composer-input').focus(); });
    return;
  }
}

document.addEventListener('keydown', (e) => {
  if (!state.me || $('#app').classList.contains('hidden')) return;
  const mod = e.ctrlKey || e.metaKey;
  // Chrome's autofill sends a keydown with no key at all.
  const key = (e.key || '').toLowerCase();
  if (mod && !e.shiftKey && !e.altKey && key === 'k') {
    e.preventDefault();
    openQuickSwitcher();
  } else if (mod && !e.shiftKey && !e.altKey && key === 'f') {
    e.preventDefault();
    openSearch();
  } else if (mod && (e.key === '/' || e.key === '?')) {
    e.preventDefault();
    openShortcuts();
  } else if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    stepRoom(e.key === 'ArrowUp' ? -1 : 1, e.shiftKey);
  }
});

// ---------------------------------------------------------------- screen readers and keyboards

// Rows that act like buttons (rooms, conversations, people) can be reached with Tab and opened
// with Enter or Space, and icon-only buttons are read out by their tooltip.
const CLICKABLE = 'li, .voice-person, .member, .switch-row';
let queued = false;
function labelThings() {
  queued = false;
  for (const el of document.querySelectorAll(CLICKABLE)) {
    if (!el.onclick || el.hasAttribute('tabindex')) continue;
    el.tabIndex = 0;
    if (!el.getAttribute('role') && el.tagName !== 'LI') el.setAttribute('role', 'button');
  }
  for (const b of document.querySelectorAll('button[title], a[title]')) {
    if (b.textContent.trim()) continue;
    if (b.getAttribute('aria-label') !== b.title) b.setAttribute('aria-label', b.title);
  }
}
new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(labelThings);
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || (e.key !== 'Enter' && e.key !== ' ')) return;
  const el = e.target;
  if (!(el instanceof HTMLElement) || el.matches('button, a, input, textarea, select, [contenteditable]') || !el.matches(CLICKABLE) || !el.onclick) return;
  e.preventDefault();
  el.click();
});

// Windows keep the keyboard inside them while open, and give it back to where it was after.
let focusBefore = null;
new MutationObserver(() => {
  const open = !$('#modal').classList.contains('hidden');
  if (open && !focusBefore) focusBefore = document.activeElement;
  else if (!open && focusBefore) {
    const back = focusBefore;
    focusBefore = null;
    if (back.isConnected && document.activeElement === document.body) back.focus?.();
  }
}).observe($('#modal'), { attributes: true, attributeFilter: ['class'] });
$('#modal').setAttribute('role', 'dialog');
$('#modal').setAttribute('aria-modal', 'true');
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || $('#modal').classList.contains('hidden')) return;
  const inside = [...$('#modal-card').querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!inside.length) return;
  const first = inside[0];
  const last = inside.at(-1);
  if (!$('#modal-card').contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// ---------------------------------------------------------------- the Android and iPhone apps
//
// The phone apps are this same page inside an app shell (Capacitor), like the desktop app is inside
// Electron. A few small native pieces reach the phone itself: Android's back button, and an
// ongoing "In a voice room" notification so a call keeps going with the screen off.

const phonePlatform = isPhoneApp ? window.Capacitor.getPlatform() : null;
const native = (plugin, method, options = {}) => window.Capacitor.nativePromise(plugin, method, options);

if (isPhoneApp) document.documentElement.classList.add(`${phonePlatform}-app`);
// The apps never zoom: not on a double tap, a pinch, or tapping into a text box (iPhones zoom into
// any box with text under 16px). On iPhones the page also reaches under the notch and the home
// bar, and keeps clear of them itself. (Android keeps the page between its bars instead.)
if (isPhoneApp) $('meta[name=viewport]').content = `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no${phonePlatform === 'ios' ? ', viewport-fit=cover' : ''}`;

/** A small tap you can feel, for buttons that change something: mute, send, a reaction. */
function haptic(style = 'LIGHT') {
  if (isPhoneApp) native('Haptics', 'impact', { style }).catch(() => {});
  else navigator.vibrate?.(10);
}

// The phone's status bar (clock, battery) follows Peiskos's light or dark theme, and on Android
// takes the page's background color. The launch screen stays up until the page has drawn, so
// opening the app never flashes a blank screen.
if (isPhoneApp) {
  const hex = (color) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = color; return c.fillStyle; };
  const syncStatusBar = () => {
    const theme = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    native('StatusBar', 'setStyle', { style: theme === 'dark' ? 'DARK' : 'LIGHT' }).catch(() => {});
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (phonePlatform === 'android' && bg) native('StatusBar', 'setBackgroundColor', { color: hex(bg) }).catch(() => {});
  };
  syncStatusBar();
  new MutationObserver(syncStatusBar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncStatusBar);
  const hideSplash = () => requestAnimationFrame(() => native('SplashScreen', 'hide', { fadeOutDuration: 250 }).catch(() => {}));
  if (document.readyState === 'complete') hideSplash();
  else window.addEventListener('load', hideSplash, { once: true });
}

// The number on the app icon: the same count as the browser tab's title (mentions and direct
// messages). iPhones only show it with permission to notify, asked the first time there's something.
let phoneBadge = 0;
function setPhoneBadge(count) {
  if (!isPhoneApp || count === phoneBadge) return;
  phoneBadge = count;
  (async () => {
    if (!count) return native('Badge', 'clear');
    let { display } = await native('Badge', 'checkPermissions');
    if (display === 'prompt' || display === 'prompt-with-rationale') ({ display } = await native('Badge', 'requestPermissions'));
    if (display === 'granted') await native('Badge', 'set', { count });
  })().catch(() => {});
}

// Back closes whatever is open, then goes from a room back to the list, then puts Peiskos away
// (still running, so a call carries on).
if (phonePlatform === 'android') {
  window.Capacitor.addListener('App', 'backButton', () => {
    if (!$('#modal').classList.contains('hidden')) return closeModal();
    if (!$('#me-menu').classList.contains('hidden')) return closeMeMenu();
    if (!$('#stage').classList.contains('hidden')) return closeStage();
    if (memberPane.classList.contains('open')) return memberPane.classList.remove('open');
    if (isPhone() && $('#app').dataset.view === 'chat') return showView('rooms');
    native('App', 'minimizeApp').catch(() => {});
  });
}
if (isPhoneApp) {
  // The buttons on the call notification (Android) and the lock screen (iPhone).
  window.Capacitor.addListener('VoiceCall', 'leave', () => leaveVoice());
  window.Capacitor.addListener('VoiceCall', 'mute', () => toggleMute());
}

// Called whenever the voice bar changes: while you're in (or getting back into) a voice room,
// Android shows an ongoing call notification and iPhones show the call on the lock screen, both
// with Mute and Leave. They go away when you leave.
let phoneCallRoom = null;
function syncPhoneCall() {
  if (!isPhoneApp) return;
  const place = roomById(state.voice?.channelId ?? state.rejoin?.channelId);
  const muted = !!state.voice?.muted;
  const key = place ? `${place.s.id}:${place.c.id}:${muted}` : null;
  if (key === phoneCallRoom) return;
  phoneCallRoom = key;
  native('VoiceCall', place ? 'start' : 'stop', place ? { title: `In ${fireName(place.c)}`, text: isDm(place.s) ? dmTitle(place.s) : place.s.name, muted } : {})
    .catch((err) => console.warn('Call notification', err));
}

// Alerts while the phone app is closed: Apple (iPhone) or Google's Firebase (Android) gives the app
// a token, which goes to the server; the server sends through them (see server/src/apns.ts and
// fcm.ts). Tapping one opens its room. Android builds made without Firebase can't get them.
const appPushKind = phonePlatform === 'ios' ? 'apns' : 'fcm';
let appPushReady = phonePlatform === 'ios';
const appPushChecked = phonePlatform === 'android'
  ? native('Alerts', 'ready').then(({ ready }) => (appPushReady = !!ready)).catch(() => false)
  : Promise.resolve(appPushReady);
let appPushToken = null;
let appPushOpen = null; // an alert tapped before Peiskos was signed in, opened once it is
async function turnOnAppPush(ask) {
  let { receive } = await native('PushNotifications', 'checkPermissions');
  if (receive !== 'granted' && ask) ({ receive } = await native('PushNotifications', 'requestPermissions'));
  if (receive !== 'granted') {
    store.set('push', '0');
    throw new Error(phonePlatform === 'ios'
      ? 'Alerts are off for Peiskos. Turn them on in the iPhone\'s Settings › Notifications › Peiskos.'
      : 'Alerts are off for Peiskos. Turn them on in the phone\'s Settings › Apps › Peiskos › Notifications.');
  }
  store.set('push', '1');
  await native('PushNotifications', 'register');
}
async function turnOffAppPush() {
  if (appPushToken) await api('/api/push', { method: 'DELETE', body: { endpoint: `${appPushKind}:${appPushToken}` } }).catch(() => {});
  await native('PushNotifications', 'unregister').catch(() => {});
}
if (isPhoneApp) {
  appPushChecked.then((ready) => {
    if (!ready) return;
    // Android sorts alerts into channels people can set up in the phone's settings; quiet hours use the silent one.
    if (phonePlatform === 'android') {
      native('PushNotifications', 'createChannel', { id: 'messages', name: 'Messages', description: 'New messages and mentions', importance: 4, vibration: true }).catch(() => {});
      native('PushNotifications', 'createChannel', { id: 'quiet', name: 'Quiet hours', description: 'Messages during your quiet hours', importance: 2 }).catch(() => {});
    }
    window.Capacitor.addListener('PushNotifications', 'registration', ({ value }) => {
      appPushToken = value;
      if (store.get('push') === '1') api(`/api/push/${appPushKind}`, { method: 'POST', body: { token: value } }).catch((err) => console.warn('Alerts', err));
    });
    window.Capacitor.addListener('PushNotifications', 'pushNotificationActionPerformed', ({ notification }) => {
      const { channelId, messageId } = notification?.data ?? {};
      if (!channelId) return;
      appPushOpen = { channelId: Number(channelId), messageId: Number(messageId) || undefined };
      if (state.me) openAppPushAlert();
    });
  });
}

function openAppPushAlert() {
  const open = appPushOpen;
  appPushOpen = null;
  if (open) jumpTo(open.channelId, open.messageId);
}

// ---------------------------------------------------------------- swipes on phones
//
// Swipe a message to the right to reply to it. Swipe in from the left edge of a room to go back
// to the rooms, and left or right along a room's header for the next or previous room.

let swipe = null;
document.addEventListener('touchstart', (e) => {
  if (!isPhone() || e.touches.length !== 1) return (swipe = null);
  const t = e.touches[0];
  const line = e.target.closest?.('#messages .line');
  const header = e.target.closest?.('.chat-header');
  const edge = t.clientX < 24 && $('#app').dataset.view === 'chat';
  swipe = { x: t.clientX, y: t.clientY, line, header, edge, moved: false };
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!swipe) return;
  const t = e.touches[0];
  const dx = t.clientX - swipe.x;
  const dy = t.clientY - swipe.y;
  if (!swipe.moved && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) return (swipe = null); // scrolling
  if (Math.abs(dx) < 12) return;
  swipe.moved = true;
  swipe.dx = dx;
  if (swipe.line && !swipe.edge && dx > 0) swipe.line.style.transform = `translateX(${Math.min(dx, 80) * 0.8}px)`;
}, { passive: true });
document.addEventListener('touchend', () => {
  const s = swipe;
  swipe = null;
  if (!s?.moved) return;
  if (s.line) s.line.style.transform = '';
  if (s.edge && s.dx > 70) return showView('rooms');
  if (s.line && s.dx > 70) {
    const m = state.messages.find((x) => x.id === Number(s.line.dataset.id));
    if (m) { haptic(); setReply(m); }
    return;
  }
  if (s.header && Math.abs(s.dx) > 70) stepRoom(s.dx < 0 ? 1 : -1, false);
});
document.addEventListener('touchcancel', () => {
  if (swipe?.line) swipe.line.style.transform = '';
  swipe = null;
});

// Hold a message for a sheet of everything you can do with it: react, reply, copy, pin and the rest
// of its ⋯ menu.
let hold = null;
document.addEventListener('touchstart', (e) => {
  clearTimeout(hold?.timer);
  hold = null;
  const line = e.target.closest?.('#messages .line');
  if (!isPhone() || !line || e.touches.length !== 1 || e.target.closest('button, a, textarea, input, .att-image, .poll')) return;
  const t = e.touches[0];
  hold = { x: t.clientX, y: t.clientY, timer: setTimeout(() => openMessageSheet(line), 450) };
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (hold && Math.hypot(t.clientX - hold.x, t.clientY - hold.y) > 10) { clearTimeout(hold.timer); hold = null; }
}, { passive: true });
for (const type of ['touchend', 'touchcancel']) document.addEventListener(type, () => { clearTimeout(hold?.timer); hold = null; });

// Lifting the finger after a hold would also count as a tap (closing the sheet that just opened).
let heldUntil = 0;
document.addEventListener('click', (e) => {
  if (Date.now() < heldUntil) { heldUntil = 0; e.stopPropagation(); e.preventDefault(); }
}, { capture: true });

function openMessageSheet(line) {
  hold = null;
  const m = state.messages.find((x) => x.id === Number(line.dataset.id));
  if (!m) return;
  haptic('MEDIUM');
  heldUntil = Date.now() + 800;
  const canEdit = m.authorId === state.me.id && !m.poll && !m.forwarded && !m.live;
  modal(`<div class="sheet-reacts">${EMOJI_CHOICES.slice(0, 6).map((e) => `<button type="button" class="sheet-react" data-emoji="${e}">${e}</button>`).join('')}<button type="button" class="sheet-react" id="sheet-more" aria-label="More reactions">${SMILE_ICON}</button></div><div class="sheet-list" id="sheet-list"></div>`, 'msg-sheet');
  $('#modal-card').querySelectorAll('[data-emoji]').forEach((b) => (b.onclick = () => { closeModal(); toggleReaction(m, b.dataset.emoji); }));
  $('#sheet-more').onclick = () => { closeModal(); openEmojiPicker(line, m); };
  const items = [
    { label: 'Reply', run: () => setReply(m) },
    canEdit && { label: 'Edit', run: () => startEdit(m, line.querySelector('.content')) },
    ...messageMenuItems(m),
  ].filter(Boolean);
  $('#sheet-list').replaceChildren(...items.map((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sheet-item' + (item.danger ? ' danger-item' : '');
    b.textContent = item.label;
    b.onclick = () => { closeModal(); item.run(); };
    return b;
  }));
}

// ---------------------------------------------------------------- working offline
//
// What you last saw (your burrows, rooms and people, and the latest messages in the rooms you
// opened) is kept on this device. If Burrow opens with no connection it shows that, says it's
// offline, and comes back to life by itself. Messages written while offline wait in a tray
// above the message box and go out once you're connected again.

const OFFLINE_ROOMS = 15;
const offlineKey = () => `offline:${state.serverUrl}`;
let roomCache = new Map(); // channel id -> its latest messages
let lastSnapshot = '';
let offline = false; // opened with no connection, showing what was saved

function rememberRoom() {
  if (!state.channelId || !state.reachedEnd || !state.messages.length) return;
  roomCache.delete(state.channelId);
  roomCache.set(state.channelId, state.messages.slice(-50));
  while (roomCache.size > OFFLINE_ROOMS) roomCache.delete(roomCache.keys().next().value);
}
function saveSnapshot() {
  if (!state.me || !state.token || offline) return;
  rememberRoom();
  const mark = `${state.channelId}:${state.messages.at(-1)?.id}:${state.servers.size}:${state.serverId}`;
  if (mark === lastSnapshot) return;
  lastSnapshot = mark;
  const snap = {
    key: state.token.slice(-8),
    at: Date.now(),
    me: state.me,
    folders: state.folders,
    favorites: state.favorites,
    servers: [...state.servers.values()],
    serverOrder: state.serverOrder,
    dmOrder: state.dmOrder,
    rooms: [...roomCache],
  };
  try { localStorage.setItem(offlineKey(), JSON.stringify(snap)); } catch {
    // Full: keep fewer rooms.
    snap.rooms = snap.rooms.slice(-3);
    try { localStorage.setItem(offlineKey(), JSON.stringify(snap)); } catch {}
  }
}
function readSnapshot() {
  try {
    const snap = JSON.parse(localStorage.getItem(offlineKey()));
    return snap && snap.key === state.token?.slice(-8) ? snap : null;
  } catch {
    return null;
  }
}
setInterval(saveSnapshot, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSnapshot(); });
window.addEventListener('pagehide', saveSnapshot);

/** Messages saved on this device for a room, when the server can't be reached. */
function cachedRoom(id) {
  if (!roomCache.size) roomCache = new Map(readSnapshot()?.rooms ?? []);
  return roomCache.get(id)?.slice() ?? null;
}

function setOffline(on) {
  offline = on;
  $('#offline-bar').classList.toggle('hidden', !on);
}

/** Burrow opened with no connection: show what was saved, if anything. Returns false if nothing was. */
function startOffline(err) {
  if (!(err instanceof TypeError) || !state.token) return false;
  const snap = readSnapshot();
  if (!snap) return false;
  roomCache = new Map(snap.rooms ?? []);
  state.me = snap.me;
  state.folders = snap.folders ?? [];
  state.favorites = snap.favorites ?? [];
  state.servers = new Map(snap.servers.map((s) => [s.id, s]));
  state.serverOrder = snap.serverOrder ?? [];
  state.dmOrder = snap.dmOrder ?? [];
  snap.servers.forEach(rememberAvatars);
  setOffline(true);
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#me-name').textContent = state.me.displayName || state.me.username;
  setAvatar($('#me-avatar'), state.me.username, state.me.avatar);
  setAvatar($('#tab-avatar'), state.me.username, state.me.avatar);
  setConnected(false, 'Offline');
  if (!state.servers.has(state.serverId)) state.serverId = state.serverOrder[0] ?? null;
  state.inDms = isDm(state.servers.get(state.serverId));
  renderServers();
  showView('rooms');
  selectServer(state.serverId, true);
  renderOutbox();
  waitForServer();
  return true;
}

// Every few seconds, and as soon as the device says it's back online, try the server again.
let waitTimer = null;
function waitForServer() {
  clearTimeout(waitTimer);
  const tryNow = async () => {
    const ok = await fetch(state.serverUrl + '/api/config', { cache: 'no-store' }).then((r) => r.ok, () => false);
    if (!ok) return (waitTimer = setTimeout(tryNow, 5000));
    window.removeEventListener('online', tryNow);
    try {
      await enterApp();
      setOffline(false);
    } catch (err) {
      if (err instanceof TypeError) waitTimer = setTimeout(tryNow, 5000);
    }
  };
  window.addEventListener('online', tryNow);
  waitTimer = setTimeout(tryNow, 5000);
}

// ---- messages waiting to send

const outboxKey = () => `outbox:${state.serverUrl}`;
const readOutbox = () => { try { return JSON.parse(store.get(outboxKey())) || []; } catch { return []; } };
const saveOutbox = (list) => store.set(outboxKey(), list.length ? JSON.stringify(list) : null);

/** Keeps a text message to send later. Returns false for anything that can't wait (files). */
function queueMessage(channelId, body) {
  if (body.attachmentIds?.length || !body.content) return false;
  saveOutbox([...readOutbox(), { id: Date.now() + Math.random(), channelId, body: { content: body.content, replyTo: body.replyTo }, at: Date.now() }]);
  renderOutbox();
  return true;
}

function renderOutbox() {
  const list = readOutbox();
  const box = $('#outbox');
  box.classList.toggle('hidden', !list.length);
  if (!list.length) return box.replaceChildren();
  const head = document.createElement('div');
  head.className = 'outbox-head';
  head.textContent = `Waiting to send · ${list.length === 1 ? '1 message' : `${list.length} messages`}. They go out when you're connected.`;
  box.replaceChildren(head, ...list.map((q) => {
    const row = document.createElement('div');
    row.className = 'outbox-row';
    const where = roomById(q.channelId);
    const label = document.createElement('span');
    label.className = 'outbox-text';
    label.textContent = (where ? `${isDm(where.s) ? dmTitle(where.s) : '#' + where.c.name}: ` : '') + q.body.content;
    const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn', title: "Don't send", textContent: '✕' });
    cancel.onclick = () => { saveOutbox(readOutbox().filter((x) => x.id !== q.id)); renderOutbox(); };
    row.append(label, cancel);
    return row;
  }));
}

let flushing = false;
async function flushOutbox() {
  if (flushing || !state.token) return;
  flushing = true;
  try {
    for (const q of readOutbox()) {
      try {
        await api(`/api/channels/${q.channelId}/messages`, { method: 'POST', body: q.body });
      } catch (err) {
        if (err instanceof TypeError) break; // still offline
        toast(`A waiting message couldn't be sent: ${err.message}`);
      }
      saveOutbox(readOutbox().filter((x) => x.id !== q.id));
    }
  } finally {
    flushing = false;
    renderOutbox();
  }
}

/** Forgets what this device kept for this account (logging out). */
function forgetOffline() {
  store.set(offlineKey(), null);
  store.set(outboxKey(), null);
  roomCache = new Map();
  lastSnapshot = '';
}

// ---------------------------------------------------------------- shared from another app (phones)
//
// Installed on Android (from the browser or as the app) and as the iPhone app, Peiskos shows in
// the share menu. In a browser the service worker catches what was shared and opens Peiskos; the
// apps hand it over themselves (on iPhones through a share extension). Either way Peiskos then
// asks which room it goes to.

async function openPendingShare() {
  if (isPhoneApp) return openAppShare();
  if (!new URLSearchParams(location.search).has('share') || !window.caches) return;
  history.replaceState(null, '', location.pathname);
  const cache = await caches.open('burrow-share');
  const meta = await cache.match('/shared/meta').then((r) => r?.json()).catch(() => null);
  if (!meta) return;
  const files = [];
  for (let i = 0; i < (meta.files ?? 0); i++) {
    const r = await cache.match(`/shared/file-${i}`);
    if (r) files.push(new File([await r.blob()], decodeURIComponent(r.headers.get('x-name') || `shared-${i}`), { type: r.headers.get('content-type') || '' }));
  }
  await caches.delete('burrow-share');
  shareInto([meta.title, meta.text, meta.url].filter(Boolean).filter((v, i, all) => all.indexOf(v) === i).join('\n'), files);
}

async function openAppShare() {
  const share = await native('Share', 'take').catch(() => null);
  const files = (share?.files ?? []).map((f) => new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
  shareInto(share?.text ?? '', files);
}
if (isPhoneApp) window.Capacitor.addListener('Share', 'shared', () => { if (state.me) openAppShare().catch(() => {}); });

function shareInto(text, files) {
  if (!text && !files.length) return;
  openPlacePicker({
    title: files.length ? `Share ${files.length === 1 ? 'a file' : `${files.length} files`} to…` : 'Share to…',
    hint: 'Pick a room or conversation. You can add to the message before sending.',
    only: (p) => p.kind !== 'burrow',
    pick: async (p) => {
      await openPlace(p.s, p.c);
      if (text) input.value = input.value ? `${input.value}\n${text}` : text;
      autosize();
      if (files.length) addFiles(files);
      input.focus();
    },
  });
}

// ---------------------------------------------------------------- after logging in

/** Run each time the app is entered: on this device's list of servers, and anything shared into it. */
function afterEnter() {
  rememberAccount();
  setOffline(false);
  renderOutbox();
  openPendingShare().catch(() => {});
  openAppPushAlert();
  // The app icon's "Messages" shortcut (long-press it on Android).
  if (new URLSearchParams(location.search).get('open') === 'dms') {
    history.replaceState(null, '', location.pathname);
    openDms();
    showView('rooms');
  }
}
