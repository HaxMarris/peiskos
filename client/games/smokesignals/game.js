/* SMOKE SIGNALS: everyone writes something to draw, and the sketchbooks go round the fire. The next
   person draws what's written, the one after guesses the drawing, the next draws that guess, and so
   on. At the end everyone turns the pages of each sketchbook together.
   The host's copy runs the game and keeps every sketchbook. Each player only ever gets the one page
   they're working from, so nobody sees how a sketchbook went until the reveal. */
'use strict';

const WRITE_SECONDS = 45;
const GRACE = 1500; // after the clock: strokes and guesses still on their way are counted
const PROMPT_MAX = 40;
const GUESS_MAX = 60;
const BATCH = 12000; // a drawing goes out in pieces this size (Peiskos takes 16 KB a message)
const MAX_STROKES = 1500;
const MAX_POINTS = 30000;

let view = { phase: 'lobby' };
const chosen = { draw: 90, guess: 45, pages: 0 };
const panel = $('panel');
/** Drawings the host has sent this copy, by key. */
const pages = new Map();
const incoming = new Map();

const toHost = (d) => (Peiskos.isHost ? hostMsg(Peiskos.me.id, d) : Peiskos.send(Peiskos.hostId, d));
const isMe = (id) => id === Peiskos.me.id;
const who = (id) => (isMe(id) ? 'You' : nameOf(id));
function waitingOn(ids) {
  if (!ids?.length) return '';
  if (ids.length > 4) return `Waiting on ${ids.length} people.`;
  const n = ids.map(who);
  return `Waiting on ${n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0]}.`;
}

// ---------- the page you draw on (or the drawing you're guessing)

const mine = [];
const sc = new SharedCanvas($('page'), {
  onStroke(part) {
    if (part.points.length && !mine.includes(part.id)) mine.push(part.id);
    toHost({ type: 'stroke', step: view.step, part });
  },
});
const undoBtn = btn('Undo', 'tool', () => {
  const id = mine.pop();
  if (!id) return;
  sc.remove(id);
  toHost({ type: 'undo', step: view.step, id });
});
const clearBtn = btn('Clear', 'tool', () => { sc.clear(); mine.length = 0; toHost({ type: 'clear', step: view.step }); });
const doneBtn = btn('Done', 'btn', () => {
  if (!sc.strokes.size) return showToast('Draw something first.');
  sc.up();
  toHost({ type: 'done', step: view.step });
});
drawingTools($('tools'), sc, [undoBtn, clearBtn, doneBtn]);

$('guessForm').onsubmit = (e) => {
  e.preventDefault();
  const text = tidy($('guess').value, GUESS_MAX);
  if (!plain(text)) return showToast('Type a guess.');
  toHost({ type: 'guess', step: view.step, text });
};

/** Paints a drawing onto a canvas of its own (the reveal's pages, the saved picture). */
function paintInto(canvas, strokes, width) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round((width * dpr * PAGE_H) / PAGE_W);
  const r = Object.assign(Object.create(SharedCanvas.prototype), {
    canvas, ctx: canvas.getContext('2d'), k: canvas.width / PAGE_W, background: '#fffdf7',
    strokes: new Map((strokes || []).map((s) => [s.id, s])), filled: new WeakMap(),
  });
  r.redraw();
}

// ---------- what everyone's copy shows

let shownTask = '';
let autoSent = '';

function render() {
  const v = view;
  const t = v.task;
  const playing = v.phase === 'pass' && t && !t.done;
  $('play').classList.toggle('hidden', !playing);
  $('screen').classList.toggle('hidden', playing);
  if (playing) return drawPlay();
  $('playHead').replaceChildren();
  sc.enabled = false;
  panel.classList.toggle('book', v.phase === 'reveal');
  redraw(panel, `${v.phase}:${v.game}:${v.step ?? ''}:${t?.done ?? ''}:${v.book ?? ''}:${v.shown ?? ''}`, draw);
  if (v.phase === 'reveal') {
    const last = panel.querySelector('.leaf.new');
    last?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

function drawPlay() {
  const v = view;
  const t = v.task;
  const key = `${v.game}:${v.step}`;
  const drawing = t.kind === 'draw';
  if (key !== shownTask) {
    shownTask = key;
    sc.clear();
    mine.length = 0;
    $('guess').value = t.text || '';
    if (drawing) { const back = pages.get(`mine:${key}`); if (back) { sc.load(back.map((s) => ({ ...s, by: null }))); mine.push(...back.map((s) => s.id)); } }
    if (!drawing) loadGuessing();
    setTimeout(() => (drawing ? null : $('guess').focus({ preventScroll: true })), 0);
  }
  sc.enabled = drawing && Date.now() < clockEnds;
  $('tools').classList.toggle('hidden', !drawing);
  $('guessForm').classList.toggle('hidden', drawing);
  const task = el('div', 'task');
  if (drawing) task.append(el('span', 'muted', 'Draw this:'), el('b', '', t.input.text));
  else task.append(el('b', '', 'What is this drawing?'));
  $('playHead').replaceChildren(...clockRow(`Page ${v.step + 1} of ${v.steps + 1}`), task);
  $('waitline').textContent = v.waiting.length > 1 || !v.waiting.includes(Peiskos.me.id) ? waitingOn(v.waiting.filter((id) => !isMe(id))) : '';
}
function loadGuessing() {
  const strokes = pages.get(view.task?.input?.key);
  if (strokes) sc.load(strokes.map((s) => ({ ...s })));
}

function draw() {
  const v = view;
  if (v.phase === 'lobby') return drawLobby();
  if (v.phase === 'write') return drawWrite();
  if (v.phase === 'pass') return drawWaiting();
  return drawReveal();
}

function drawLobby() {
  panel.append(el('h1', '', 'Smoke Signals'), playerChips());
  panel.append(el('p', 'how muted', 'Everyone writes something to draw. Your sketchbook then goes round the fire: the next person draws what you wrote, the one after guesses what the drawing is, the next draws that guess, and so on. At the end you turn the pages of each sketchbook together.'));
  const few = Peiskos.players.length < 3;
  if (Peiskos.isHost) {
    const opts = el('div', 'opts');
    opts.append(
      ...choice('optDraw', 'Time to draw', [[60, '60 seconds'], [90, '90 seconds'], [120, '2 minutes']], chosen.draw, (n) => { chosen.draw = n; }),
      ...choice('optGuess', 'Time to guess', [[30, '30 seconds'], [45, '45 seconds'], [60, '60 seconds']], chosen.guess, (n) => { chosen.guess = n; }),
      ...choice('optPages', 'Pages', [[0, 'Everyone gets a turn'], [4, 'Up to 4'], [6, 'Up to 6'], [8, 'Up to 8']], chosen.pages, (n) => { chosen.pages = n; }),
    );
    panel.append(opts);
    if (few) panel.append(el('p', 'note muted', 'Smoke Signals needs 3 players. Waiting for more to join.'));
  } else panel.append(el('p', 'note muted', `Waiting for ${nameOf(Peiskos.hostId)} to start.`));
  const row = el('div', 'row');
  if (Peiskos.isHost) {
    const start = btn('Start', 'btn', hostStart);
    start.disabled = few;
    row.append(start);
  }
  panel.append(row);
}

function drawWrite() {
  const v = view;
  panel.append(...clockRow('Page 1'));
  if (!v.inGame) {
    panel.append(el('h2', '', 'This round started before you joined'), el('p', 'note muted', 'You\'re in the next one. You can watch the sketchbooks at the end.'));
    return;
  }
  if (v.mine == null) {
    panel.append(el('h2', '', 'Write something to draw'));
    const send = (text) => {
      const prompt = tidy(text, PROMPT_MAX);
      if (!plain(prompt)) return showToast('Write something, or pick one.');
      toHost({ type: 'prompt', game: v.game, text: prompt });
    };
    panel.append(composer('prompt', 'A thing, a person, a scene...', PROMPT_MAX, 'Send', send));
    if (v.suggest?.length) {
      panel.append(el('p', 'muted small', 'Or pick one:'));
      const row = el('div', 'suggest');
      for (const w of v.suggest) row.append(btn(w, 'btn secondary', () => send(w)));
      panel.append(row);
    }
    panel.append(el('p', 'note muted small', 'If time runs out, you get the first of these.'));
  } else {
    const sent = el('p', 'sent');
    sent.append(el('span', 'muted small', 'You wrote '), el('b', '', v.mine));
    panel.append(sent);
  }
  panel.append(el('p', 'note muted', waitingOn(v.waiting.filter((id) => !isMe(id)))));
}

function drawWaiting() {
  const v = view;
  panel.append(...clockRow(`Page ${v.step + 1} of ${v.steps + 1}`));
  if (!v.inGame) panel.append(el('h2', '', 'This round started before you joined'), el('p', 'note muted', 'You\'re in the next one. You can watch the sketchbooks at the end.'));
  else if (!v.task) panel.append(el('h2', '', 'Nothing for you on this page'), el('p', 'note muted', 'The sketchbook that would have come to you is missing a page. The next one will.'));
  else {
    panel.append(el('h2', '', v.task.kind === 'draw' ? 'Drawing sent' : 'Guess sent'));
    if (v.task.kind === 'guess') {
      const sent = el('p', 'sent');
      sent.append(el('span', 'muted small', 'You guessed '), el('b', '', v.task.text));
      panel.append(sent);
    }
    const row = el('div', 'row');
    row.append(btn(v.task.kind === 'draw' ? 'Keep drawing' : 'Change guess', 'btn secondary', () => toHost({ type: 'more', step: v.step })));
    panel.append(row);
  }
  panel.append(el('p', 'note muted', waitingOn(v.waiting) || 'Turning the page...'));
}

let turnedTo = '';
function drawReveal() {
  const v = view;
  // Only a page just turned slides in; a redraw for any other reason leaves the pages still.
  const turned = turnedTo !== `${v.game}:${v.book}:${v.shown}`;
  turnedTo = `${v.game}:${v.book}:${v.shown}`;
  const head = el('div', 'bookhead');
  head.append(el('h1', '', isMe(v.owner) ? 'Your sketchbook' : `${nameOf(v.owner)}'s sketchbook`), el('span', 'muted small', `${v.book + 1} of ${v.books}`));
  panel.append(head);
  if (v.note) panel.append(el('p', 'note muted small', v.note));
  const list = el('ol', 'pages');
  list.setAttribute('aria-label', 'Pages');
  v.entries.forEach((e, i) => {
    const li = el('li', `leaf${e.missing ? ' gone' : ''}${i === v.entries.length - 1 && i > 0 && turned ? ' new' : ''}`);
    if (e.missing) li.append(el('span', 'said', e.kind === 'drawing' ? `No drawing from ${who(e.by)}.` : `No guess from ${who(e.by)}.`));
    else if (e.kind === 'drawing') {
      const c = el('canvas');
      c.dataset.key = e.key;
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', `${who(e.by)}'s drawing`);
      paintInto(c, pages.get(e.key), 680);
      li.append(c, el('span', 'who', `${who(e.by)} drew this`));
    } else li.append(el('span', 'said', e.text), el('span', 'who', i === 0 ? `${who(e.by)} wrote this` : `${who(e.by)} guessed this`));
    list.append(li);
  });
  panel.append(list);
  const done = v.shown >= v.length;
  const row = el('div', 'row');
  if (Peiskos.isHost) {
    if (!done) row.append(btn('Turn the page', 'btn', hostTurn));
    else if (v.book + 1 < v.books) row.append(btn('Next sketchbook', 'btn', hostTurn));
    else row.append(btn('Back to the lobby', 'btn', hostLobby));
  } else if (!done || v.book + 1 < v.books) row.append(el('span', 'muted small', `${nameOf(Peiskos.hostId)} turns the pages.`));
  else row.append(el('span', 'muted small', `${nameOf(Peiskos.hostId)} can start another game.`));
  if (done) row.append(btn('Save sketchbook', 'btn secondary', () => saveBook(v)));
  panel.append(row);
}

/** The whole sketchbook as one tall picture. */
function saveBook(v) {
  const W = 1000, PAD = 40, DW = W - PAD * 2, DH = Math.round((DW * PAGE_H) / PAGE_W);
  const heights = v.entries.map((e) => (e.kind === 'drawing' && !e.missing ? DH + 56 : 120));
  const out = document.createElement('canvas');
  out.width = W;
  out.height = 110 + heights.reduce((a, b) => a + b + 24, 0) + PAD;
  const c = out.getContext('2d');
  c.fillStyle = '#1c1612';
  c.fillRect(0, 0, W, out.height);
  c.fillStyle = '#fbf4ec';
  c.font = '600 40px Fraunces, Georgia, serif';
  c.fillText(isMe(v.owner) ? `${Peiskos.me.name}'s sketchbook` : `${nameOf(v.owner)}'s sketchbook`, PAD, 72);
  let y = 110;
  v.entries.forEach((e, i) => {
    const h = heights[i];
    c.fillStyle = '#fffdf7';
    c.fillRect(PAD - 16, y, DW + 32, h);
    c.fillStyle = '#6b5a4b';
    c.font = '400 20px "Nunito Sans", system-ui, sans-serif';
    const by = nameOf(e.by);
    if (e.missing) c.fillText(e.kind === 'drawing' ? `No drawing from ${by}.` : `No guess from ${by}.`, PAD, y + 66);
    else if (e.kind === 'drawing') {
      const pic = document.createElement('canvas');
      const keep = window.devicePixelRatio;
      paintInto(pic, pages.get(e.key), DW / (keep || 1));
      c.drawImage(pic, PAD, y + 12, DW, DH);
      c.fillText(`${by} drew this`, PAD, y + DH + 42);
    } else {
      c.fillText(i === 0 ? `${by} wrote this` : `${by} guessed this`, PAD, y + 98);
      c.fillStyle = '#2a1f18';
      c.font = '600 36px Fraunces, Georgia, serif';
      c.fillText(e.text, PAD, y + 56, DW);
    }
    y += h + 24;
  });
  const bytes = atob(out.toDataURL('image/png').split(',')[1]);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  Peiskos.save(new Blob([buf], { type: 'image/png' }), 'sketchbook.png');
}

// The clock: a drawing stops when it runs out, and a typed guess goes in on its own.
setInterval(() => {
  const v = view;
  if (v.phase !== 'pass' || !v.task || v.task.done || Date.now() < clockEnds) return;
  const key = `${v.game}:${v.step}`;
  if (v.task.kind === 'draw' && sc.enabled) { sc.up(); sc.enabled = false; }
  if (v.task.kind === 'guess' && autoSent !== key) {
    autoSent = key;
    const text = tidy($('guess').value, GUESS_MAX);
    if (plain(text)) toHost({ type: 'guess', step: v.step, text });
  }
}, 250);

// ---------- what the host says

function onView(d) {
  if (d.type === 'page') {
    if (d.first) incoming.set(d.key, []);
    const got = incoming.get(d.key);
    if (!got) return;
    for (const s of d.strokes || []) got.push(s);
    if (!d.last) return;
    incoming.delete(d.key);
    pages.set(d.key, got);
    if (view.phase === 'pass' && view.task?.input?.key === d.key) loadGuessing();
    // Back from a reload mid-drawing: what you'd drawn so far.
    if (d.key === `mine:${shownTask}` && !sc.strokes.size) { sc.load(got.map((s) => ({ ...s, by: null }))); mine.push(...got.map((s) => s.id)); }
    for (const c of panel.querySelectorAll('canvas[data-key]')) if (c.dataset.key === d.key) paintInto(c, got, 680);
    return;
  }
  if (d.type !== 'state') return;
  const before = view;
  const v = view = d.view;
  setClock(v.left, v.total);
  if (v.phase === 'lobby' && before.game !== v.game) { pages.clear(); shownTask = ''; }
  const fresh = before.phase !== v.phase || before.step !== v.step || before.book !== v.book;
  if (fresh) {
    if (v.phase === 'write') say('Write something to draw.');
    else if (v.phase === 'pass' && v.task) say(v.task.kind === 'draw' ? `Draw this: ${v.task.input.text}` : 'Guess what the drawing is.');
    else if (v.phase === 'reveal') say(`${who(v.owner)}'s sketchbook.`);
  } else if (v.phase === 'reveal' && before.shown !== v.shown) {
    const e = v.entries[v.entries.length - 1];
    if (e) say(e.missing ? 'A missing page.' : e.kind === 'drawing' ? `${who(e.by)} drew this.` : `${who(e.by)} guessed: ${e.text}`);
  }
  // Mid-game, this page can't move to its own window (the host's copy says so for itself).
  if (!Peiskos.isHost) Peiskos.busy(v.phase === 'write' || v.phase === 'pass');
  render();
}

// ---------- the host's game

let G = null;
let tick = 0;
let gameNo = 0;
let ourWords = [];

function hostLobby() {
  clearInterval(tick);
  G = { phase: 'lobby', game: ++gameNo, scores: new Map(Peiskos.players.map((p) => [p.id, 0])) };
  Peiskos.busy(false);
  broadcast();
}

const here = () => new Set(Peiskos.players.map((p) => p.id));
const setEnds = (ms) => { G.total = ms; G.endsAt = Date.now() + ms; };
/** Who holds sketchbook i at a step after the first page. With an even count the owner draws their own first, so the last page is a guess. */
const holder = (i, s) => G.order[(i + s - 1 + G.offset) % G.order.length];
const lastPage = (book, before = book.entries.length) => { for (let j = before - 1; j >= 0; j--) if (!book.entries[j].missing) return j; return -1; };

function viewFor(id) {
  const v = { phase: G.phase, game: G.game, scores: [] };
  if (G.phase === 'lobby') return v;
  v.inGame = G.order.includes(id);
  if (G.phase === 'write' || G.phase === 'pass') Object.assign(v, { step: G.step, steps: G.steps, left: Math.max(0, G.endsAt - Date.now()), total: G.total, waiting: waiting() });
  if (G.phase === 'write') {
    const book = G.books.find((b) => b.owner === id);
    v.mine = book?.entries[0]?.text || null;
    v.suggest = G.suggest.get(id) || [];
  } else if (G.phase === 'pass') {
    const i = G.holding.get(id);
    if (i !== undefined) {
      const book = G.books[i];
      const e = book.entries[G.step];
      const from = book.entries[lastPage(book, G.step)];
      v.task = { kind: e.kind === 'drawing' ? 'draw' : 'guess', done: e.done, text: e.kind === 'text' ? e.text : '',
        input: e.kind === 'drawing' ? { text: from.text } : { key: `b${i}e${lastPage(book, G.step)}` } };
    }
  } else if (G.phase === 'reveal') {
    const i = G.reveal[G.book];
    const book = G.books[i];
    Object.assign(v, { book: G.book, books: G.reveal.length, owner: book.owner, shown: G.shown, length: book.entries.length, note: G.note || '',
      entries: book.entries.slice(0, G.shown).map((e, j) => ({ by: e.by, kind: e.kind, missing: !!e.missing, text: e.kind === 'text' ? e.text : undefined, key: e.kind === 'drawing' ? `b${i}e${j}` : undefined })) });
  }
  return v;
}

/** Who still has a page to finish. */
function waiting() {
  const at = here();
  if (G.phase === 'write') return G.books.filter((b) => at.has(b.owner) && !b.entries[0]).map((b) => b.owner);
  return [...G.holding].filter(([id, i]) => at.has(id) && !G.books[i].entries[G.step].done).map(([id]) => id);
}

async function hostStart() {
  if (G.phase !== 'lobby' || G.starting || Peiskos.players.length < 3) return;
  G.starting = true;
  try { ourWords = (await Peiskos.api(`/api/servers/${Peiskos.serverId}/game-words`)).words; } catch { /* the pack still works */ }
  G.starting = false;
  if (G.phase !== 'lobby' || Peiskos.players.length < 3) return render();
  G.order = shuffle(Peiskos.players.map((p) => p.id));
  const n = G.order.length;
  G.offset = n % 2;
  const full = n % 2 ? n - 1 : n;
  G.steps = chosen.pages ? Math.min(full, chosen.pages) : full;
  G.drawMs = chosen.draw * 1000;
  G.guessMs = chosen.guess * 1000;
  G.books = G.order.map((owner) => ({ owner, entries: [] }));
  const pool = shuffle([...new Set([...WORDS, ...ourWords, ...ourWords].filter((w) => plain(w)))]);
  G.suggest = new Map(G.order.map((id, k) => [id, pool.slice(k * 3, k * 3 + 3)]));
  G.phase = 'write';
  G.step = 0;
  G.holding = new Map();
  setEnds(WRITE_SECONDS * 1000);
  Peiskos.busy(true);
  clearInterval(tick);
  tick = setInterval(hostTick, 250);
  broadcast();
}

function hostTick() {
  if ((G.phase === 'write' || G.phase === 'pass') && Date.now() >= G.endsAt + GRACE) nextStep();
}

/** Ends the page everyone's on and hands each sketchbook to its next person. */
function nextStep() {
  const at = here();
  if (G.phase === 'write') {
    for (const b of G.books) if (!b.entries[0] && at.has(b.owner)) b.entries[0] = { by: b.owner, kind: 'text', text: G.suggest.get(b.owner)?.[0] || 'a campfire' };
    G.books = G.books.filter((b) => b.entries[0]);
    // A sketchbook whose owner left before writing is gone; the order (and who holds what) is the ones left.
    G.order = G.books.map((b) => b.owner);
    G.offset = G.order.length % 2;
    const full = G.order.length % 2 ? G.order.length - 1 : G.order.length;
    G.steps = Math.min(G.steps, full);
  } else {
    for (const b of G.books) {
      const e = b.entries[G.step];
      if (!e || e.missing) continue;
      if (e.kind === 'drawing') { e.strokes = [...e.live.values()].slice(0, MAX_STROKES); delete e.live; if (!e.strokes.length) e.missing = true; } else if (!plain(e.text)) e.missing = true;
      e.done = true;
    }
  }
  G.step++;
  const playing = G.order.filter((id) => at.has(id)).length;
  if (G.step > G.steps || playing < 2) return startReveal(playing < 2 && G.step <= G.steps ? 'Everyone else left, so these are the sketchbooks so far.' : '');
  G.phase = 'pass';
  G.holding = new Map();
  let anyDraw = false;
  G.books.forEach((b, i) => {
    const by = holder(i, G.step);
    const from = b.entries[lastPage(b)];
    const kind = from.kind === 'text' ? 'drawing' : 'text';
    const e = { by, kind, done: false, text: '' };
    if (kind === 'drawing') e.live = new Map();
    if (!at.has(by)) { e.missing = true; e.done = true; } else {
      G.holding.set(by, i);
      if (kind === 'drawing') anyDraw = true;
      else sendDrawing(by, `b${i}e${lastPage(b)}`, from.strokes);
    }
    b.entries[G.step] = e;
  });
  setEnds(anyDraw ? G.drawMs : G.guessMs);
  broadcast();
}

function startReveal(note) {
  clearInterval(tick);
  G.books = G.books.map((b) => ({ ...b, entries: b.entries.filter(Boolean) }));
  G.reveal = G.books.map((_, i) => i);
  G.phase = 'reveal';
  G.note = note;
  G.book = 0;
  G.shown = 1;
  Peiskos.busy(true);
  broadcast();
}

function hostTurn() {
  if (G.phase !== 'reveal') return;
  const i = G.reveal[G.book];
  const book = G.books[i];
  if (G.shown < book.entries.length) {
    const e = book.entries[G.shown];
    if (e.kind === 'drawing' && !e.missing) sendDrawing('all', `b${i}e${G.shown}`, e.strokes);
    G.shown++;
  } else if (G.book + 1 < G.reveal.length) { G.book++; G.shown = 1; G.note = ''; } else return;
  broadcast();
}

/** A drawing to one player or to everyone, in pieces small enough for Peiskos to pass on. */
function sendDrawing(to, key, strokes = []) {
  if (to === Peiskos.me.id || to === 'all') onView({ type: 'page', key, strokes, first: true, last: true });
  if (to === Peiskos.me.id) return;
  let batch = [];
  let size = 0;
  let first = true;
  const out = (last) => { Peiskos.send(to, { type: 'page', key, strokes: batch, first, last }); first = false; batch = []; size = 0; };
  for (const s of strokes) {
    const n = JSON.stringify(s).length;
    if (size + n > BATCH && batch.length) out(false);
    if (n <= BATCH) { batch.push(s); size += n; }
  }
  out(true);
}

/** The page a player is working on right now, if they're on one. */
function taskOf(id, step) {
  if (G.phase !== 'pass' || step !== G.step) return null;
  const i = G.holding.get(id);
  const e = i === undefined ? null : G.books[i].entries[G.step];
  return e && !e.missing ? e : null;
}

function addStroke(from, e, part) {
  if (!part || typeof part.id !== 'string' || !Array.isArray(part.points)) return;
  if (part.fill && from !== Peiskos.me.id && fillTooFast(from)) return;
  const id = part.id.slice(0, 24);
  let s = e.live.get(id);
  if (!s) {
    if (e.live.size >= MAX_STROKES) return;
    s = { id, color: String(part.color).slice(0, 9), size: Math.min(60, Math.max(1, Number(part.size) || 10)), erase: !!part.erase && !part.fill, fill: !!part.fill, points: [] };
    e.live.set(id, s);
  } else if (s.fill) return;
  e.points = (e.points || 0);
  for (const p of part.points.slice(0, s.fill ? 1 : 400)) {
    if (e.points >= MAX_POINTS) break;
    if (!Array.isArray(p)) continue;
    s.points.push([Math.round(Number(p[0])) || 0, Math.round(Number(p[1])) || 0]);
    e.points++;
  }
  if (!s.points.length) e.live.delete(id);
}

function hostMsg(from, d) {
  if (!G) return;
  if (hello(from, d)) {
    // A page that has just loaded gets what it's working from (and, mid-drawing, its own strokes back).
    if (G.phase === 'pass' && G.holding.has(from)) {
      const i = G.holding.get(from);
      const e = G.books[i].entries[G.step];
      const book = G.books[i];
      if (e.kind === 'drawing') sendDrawing(from, `mine:${G.game}:${G.step}`, [...e.live.values()]);
      else sendDrawing(from, `b${i}e${lastPage(book, G.step)}`, book.entries[lastPage(book, G.step)].strokes);
    } else if (G.phase === 'reveal') {
      const i = G.reveal[G.book];
      G.books[i].entries.slice(0, G.shown).forEach((e, j) => { if (e.kind === 'drawing' && !e.missing) sendDrawing(from, `b${i}e${j}`, e.strokes); });
    }
    return;
  }
  if (d.type === 'prompt') {
    if (G.phase !== 'write' || d.game !== G.game) return;
    const book = G.books.find((b) => b.owner === from);
    const text = tidy(d.text, PROMPT_MAX);
    if (!book || book.entries[0] || !plain(text)) return;
    book.entries[0] = { by: from, kind: 'text', text };
    if (!waiting().length) return nextStep();
    return broadcast();
  }
  const e = taskOf(from, d.step);
  if (!e) return;
  if (e.kind === 'drawing' && !e.done) {
    if (d.type === 'stroke') return addStroke(from, e, d.part);
    if (d.type === 'undo') { e.live.delete(String(d.id).slice(0, 24)); return; }
    if (d.type === 'clear') { e.live.clear(); e.points = 0; return; }
  }
  if (d.type === 'done' && e.kind === 'drawing' && e.live.size) e.done = true;
  else if (d.type === 'guess' && e.kind === 'text') {
    const text = tidy(d.text, GUESS_MAX);
    if (!plain(text)) return;
    e.text = text;
    e.done = true;
  } else if (d.type === 'more' && Date.now() < G.endsAt) e.done = false;
  else return;
  if (!waiting().length) return nextStep();
  broadcast();
}

Peiskos.on('players', () => {
  if (!Peiskos.isHost) { if (view.phase === 'lobby') render(); return; }
  for (const p of Peiskos.players) if (!G.scores.has(p.id)) G.scores.set(p.id, 0);
  if ((G.phase === 'write' || G.phase === 'pass') && (!waiting().length || G.order.filter((id) => here().has(id)).length < 2)) return nextStep();
  broadcast();
});

// Sending each player their own view and answering a page that has just loaded work the same as in
// the other party games (shared/party.js).
const { broadcast, hello } = partyHost({ state: () => G, viewFor, onView, hostMsg, hostLobby, render });
Peiskos.on('init', () => { if (Peiskos.isHost) Peiskos.api(`/api/servers/${Peiskos.serverId}/game-words`).then((r) => { ourWords = r.words; }, () => {}); });

// Leaving is in Peiskos's game bar; the host ending the game ends it for everyone.
