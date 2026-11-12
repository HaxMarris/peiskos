/* What the talk-and-type party games (Odd One Out, Same Page) share: buttons, the score list,
   the countdown, and redrawing the panel without losing what you were typing. */
'use strict';

function btn(text, cls = 'btn', onclick) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onclick) b.onclick = onclick;
  return b;
}

/** Typed text as the games keep it: no control characters, single spaces, a set length. */
const tidy = (text, max) => String(text ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** For comparing two answers: letters and digits only, no accents, no capitals. */
const plain = (text) => String(text ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function scoreList(scores, final) {
  const ul = el('ul', 'scores');
  // Someone who has left isn't listed.
  scores.filter(([id]) => Peiskos.players.some((p) => p.id === id)).sort((a, b) => b[1] - a[1]).forEach(([id, pts], i) => {
    const li = el('li', id === Peiskos.me.id ? 'me' : '');
    li.append(el('span', '', `${final ? (['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`) + ' ' : ''}${nameOf(id)}`), el('b', '', String(pts)));
    ul.append(li);
  });
  return ul;
}

function playerChips() {
  const people = el('div', 'players');
  for (const p of Peiskos.players) people.append(el('span', `chip${p.id === Peiskos.hostId ? ' host' : ''}`, p.name));
  return people;
}

/** A labelled choice in the lobby. */
function choice(id, label, options, value, onchange) {
  const l = el('label', '', label);
  l.htmlFor = id;
  const s = el('select');
  s.id = id;
  for (const [v, t] of options) { const o = el('option', '', t); o.value = v; o.selected = v === value; s.append(o); }
  s.onchange = () => onchange(Number(s.value));
  return [l, s];
}

// ---------- the countdown: a bar that runs down, and the seconds beside it

let clockEnds = 0;
let clockTotal = 1;
function setClock(left, total) { clockEnds = Date.now() + (left ?? 0); clockTotal = Math.max(1, total ?? 1); }
function clockRow(text) {
  const row = el('div', 'head');
  const secs = el('span', 'secs');
  secs.id = 'secs';
  secs.setAttribute('aria-hidden', 'true');
  row.append(el('span', 'muted', text), secs);
  const bar = el('div', 'bar');
  const fill = el('span');
  fill.id = 'fill';
  bar.append(fill);
  paintClock(fill, secs);
  return [row, bar];
}
function paintClock(fill = $('fill'), secs = $('secs')) {
  if (!fill) return;
  const left = Math.max(0, clockEnds - Date.now());
  fill.style.width = `${Math.min(100, (left / clockTotal) * 100)}%`;
  if (secs) { secs.textContent = String(Math.ceil(left / 1000)); secs.classList.toggle('low', left < 6000); }
}
setInterval(paintClock, 200);

/** Said to screen readers once, when something changes (the panel itself is redrawn far more often). */
const say = (text) => { $('say').textContent = text; };

/** Redraws the panel. While it's still the same step of the game, what you'd typed, what had focus and how far you'd scrolled stay. */
let shownKey = '';
function redraw(panel, key, draw) {
  const controls = () => [...panel.querySelectorAll('button, input, select')];
  const keep = key === shownKey ? {
    scroll: panel.scrollTop,
    focus: controls().indexOf(document.activeElement),
    typed: [...panel.querySelectorAll('input[id]')].map((i) => [i.id, i.value, i.selectionStart, i.selectionEnd]),
  } : null;
  shownKey = key;
  panel.replaceChildren();
  draw();
  if (!keep) {
    panel.scrollTop = 0;
    panel.querySelector('input[data-first]')?.focus({ preventScroll: true });
    return;
  }
  for (const [id, value, from, to] of keep.typed) {
    const i = $(id);
    if (i && !i.disabled) { i.value = value; try { i.setSelectionRange(from, to); } catch (e) { /* not a text box */ } }
  }
  panel.scrollTop = keep.scroll;
  if (keep.focus >= 0) controls()[keep.focus]?.focus({ preventScroll: true });
}

/** A text box with its button; Enter sends too. */
function composer(id, label, max, action, send) {
  const row = el('form', 'composer');
  const input = el('input');
  input.id = id;
  input.maxLength = max;
  input.autocomplete = 'off';
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('aria-label', label);
  input.placeholder = label;
  input.dataset.first = '';
  input.enterKeyHint = 'send';
  const go = el('button', 'btn', action);
  go.type = 'submit';
  row.onsubmit = (e) => { e.preventDefault(); send(input.value, input); };
  row.append(input, go);
  return row;
}

// ---------- the host's side: one copy of the game runs in the host's page and tells the rest

/**
 * What the host's copy does the same way in every party game: sends each player their own view,
 * answers a page that has just loaded, and picks the scores back up when the page loads again
 * (popping out, say). `state()` is the host's game, with its `scores`; the rest are the game's own.
 */
function partyHost({ state, viewFor, onView, hostMsg, hostLobby, render }) {
  const broadcast = () => {
    for (const p of Peiskos.players) {
      const d = { type: 'state', view: viewFor(p.id) };
      if (p.id === Peiskos.me.id) onView(d); else Peiskos.send(p.id, d);
    }
    Peiskos.snapshot({ scores: [...state().scores] });
  };
  /** A page that has just loaded asks where the game is. True when that's what this message was. */
  const hello = (from, d) => {
    if (d.type !== 'hello') return false;
    if (!state().scores.has(from)) state().scores.set(from, 0);
    Peiskos.send(from, { type: 'state', view: viewFor(from) });
    return true;
  };
  Peiskos.on('msg', (from, d) => {
    if (Peiskos.isHost) return hostMsg(from, d);
    if (from === Peiskos.hostId) onView(d);
  });
  Peiskos.on('init', (resume) => {
    if (Peiskos.isHost) {
      hostLobby();
      const scores = state().scores;
      if (resume && Array.isArray(resume.scores)) { for (const [id, pts] of resume.scores) if (scores.has(id)) scores.set(id, Number(pts) || 0); broadcast(); }
    } else Peiskos.send(Peiskos.hostId, { type: 'hello' });
    render();
  });
  return { broadcast, hello };
}
