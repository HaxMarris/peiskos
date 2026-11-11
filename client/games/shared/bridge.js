/* Talking to Peiskos from a game page at the fire.
   Peiskos frames the page; whoever started the game is the host. Messages between players go
   through Peiskos's server: a player's go to the host, and the host's to one player or all. */
'use strict';

const Peiskos = (() => {
  const host = () => { try { return window.parent.peiskosHost || window.parent; } catch (e) { return window.parent; } };
  const post = (msg) => host().postMessage(msg, '*');
  const handlers = { init: [], players: [], msg: [] };
  const waiting = new Map();
  let nextId = 1;
  const self = {
    me: null, hostId: null, isHost: false, serverId: null, players: [],
    on(kind, fn) { handlers[kind].push(fn); },
    /** To the host (from a player), or to 'all' or one player's id (from the host). */
    send(to, data) { post({ kind: 'send', to, data }); },
    leave() { post({ kind: 'leave' }); },
    /** What the host's game needs to carry on if the page reloads (moving to its own window). */
    snapshot(data) { post({ kind: 'snapshot', data }); },
    busy(on) { post({ kind: 'busy', on }); },
    /** Saves a file through Peiskos (a game's frame can't download or share on every phone). */
    save(blob, name) { post({ kind: 'save', blob, name }); },
    /** Asks Peiskos's server (only the few things games may ask for). */
    api(path, method = 'GET', body) {
      const id = nextId++;
      post({ kind: 'api', id, path, method, body });
      return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
    },
  };
  window.addEventListener('message', (e) => {
    if (e.source !== host()) return;
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.kind === 'init') {
      self.me = { id: m.me.id, name: String(m.me.name || 'Player').slice(0, 24) };
      self.hostId = m.hostId;
      self.isHost = m.me.id === m.hostId;
      self.serverId = m.serverId ?? null;
      self.players = m.players || [];
      handlers.init.forEach((fn) => fn(m.resume || null));
    } else if (m.kind === 'players') {
      for (const p of self.players) seenNames.set(p.id, p.name);
      self.players = m.players || [];
      handlers.players.forEach((fn) => fn(self.players));
    } else if (m.kind === 'msg') {
      if (!m.data || typeof m.data !== 'object') return;
      handlers.msg.forEach((fn) => fn(m.from, m.data));
    } else if (m.kind === 'api-result') {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      m.error ? w.reject(new Error(m.error)) : w.resolve(m.data);
    }
  });
  // Ready once the page's own scripts (which load after this one) have set up their handlers.
  const ready = () => post({ kind: 'ready' });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else setTimeout(ready, 0);
  return self;
})();

/** Small helpers every game uses. */
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
// Names are kept after someone leaves, so "Ines left" and a final score still say who.
const seenNames = new Map();
function nameOf(id) {
  for (const p of Peiskos.players) seenNames.set(p.id, p.name);
  return String(seenNames.get(id) ?? 'Someone').slice(0, 24);
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
let toastTimer = 0;
function showToast(text) {
  let t = $('toast');
  if (!t) { t = el('div', 'toast'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}
