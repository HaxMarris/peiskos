/* SKETCH & GUESS: take turns drawing a word while everyone else guesses it.
   The host's copy runs the game: it picks words, keeps time and scores, and checks guesses, so the
   word only ever reaches whoever is drawing (and, once they've got it, whoever guessed it). */
'use strict';

const CHOOSE_SECONDS = 15;
const REVEAL_SECONDS = 5;
const BATCH = 12000;

// ---------- what everyone's copy shows

let view = { phase: 'lobby', scores: [], guessed: [] };
let endsAt = 0;
let shownTurn = -1;
const mine = [];

const sc = new SharedCanvas($('page'), {
  onStroke(part) {
    if (part.points.length && !mine.includes(part.id)) mine.push(part.id);
    if (Peiskos.isHost) hostStroke(Peiskos.me.id, part);
    else Peiskos.send(Peiskos.hostId, { type: 'stroke', part });
  },
});
const undoBtn = el('button', 'tool', 'Undo');
undoBtn.type = 'button';
undoBtn.onclick = () => {
  const id = mine.pop();
  if (!id) return;
  sc.remove(id);
  toHost({ type: 'undo', id });
};
const clearBtn = el('button', 'tool', 'Clear');
clearBtn.type = 'button';
clearBtn.onclick = () => { sc.clear(); mine.length = 0; toHost({ type: 'clear' }); };
drawingTools($('tools'), sc, [undoBtn, clearBtn]);

/** A move from this copy: the host's own go straight to its game, everyone else's through Peiskos. */
function toHost(d) {
  if (Peiskos.isHost) hostMsg(Peiskos.me.id, d);
  else Peiskos.send(Peiskos.hostId, d);
}

const isDrawer = () => view.drawer === Peiskos.me?.id;

function render() {
  const v = view;
  if (v.turn !== shownTurn && (v.phase === 'choose' || v.phase === 'lobby')) { shownTurn = v.turn; sc.clear(); mine.length = 0; }
  $('roundLabel').textContent = v.phase === 'lobby' || v.phase === 'over' ? '' : `Round ${v.round} of ${v.rounds}`;
  const word = v.mask ?? '';
  $('word').textContent = v.phase === 'choose' ? `${nameOf(v.drawer)} is choosing` : v.word ? v.word : spaced(word);
  $('word').title = v.phase === 'draw' && !v.word ? `${(v.mask || '').replace(/ /g, '').length} letters` : '';
  const drawing = v.phase === 'draw' && isDrawer();
  sc.enabled = drawing;
  $('tools').classList.toggle('off', !drawing);
  const got = v.guessed.includes(Peiskos.me.id);
  $('guess').disabled = drawing || v.phase === 'lobby' || v.phase === 'over';
  $('guess').placeholder = drawing ? 'You\'re drawing' : got && v.phase === 'draw' ? 'Chat with those who got it' : 'Type your guess';
  document.body.classList.toggle('drawing', drawing);
  renderScores();
  renderOverlay();
}
const spaced = (mask) => mask.split('').map((ch) => (ch === ' ' ? '  ' : ch)).join(' ');

function renderScores() {
  const ul = $('scores');
  ul.innerHTML = '';
  for (const [id, pts] of [...view.scores].sort((a, b) => b[1] - a[1])) {
    const li = el('li');
    if (id === Peiskos.me.id) li.classList.add('me');
    if (id === view.drawer && view.phase !== 'lobby' && view.phase !== 'over') li.classList.add('drawing');
    if (view.guessed.includes(id)) li.classList.add('got');
    li.append(el('span', '', nameOf(id)), el('b', '', String(pts)));
    ul.append(li);
  }
}

function renderOverlay() {
  const v = view;
  const box = $('overlay');
  const panel = $('lobby');
  if (v.phase === 'draw' || v.phase === 'reveal') { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  if (v.phase === 'lobby' && !editing) return renderLobby();
  if (editing) return;
  panel.innerHTML = '';
  if (v.phase === 'choose') {
    if (isDrawer() && v.choices) {
      panel.append(el('h2', '', 'Pick a word to draw'));
      const row = el('div', 'choices');
      v.choices.forEach((w, i) => {
        const b = el('button', 'btn', w);
        b.type = 'button';
        b.onclick = () => toHost({ type: 'pick', i });
        row.append(b);
      });
      panel.append(row, el('p', 'muted small', `${CHOOSE_SECONDS} seconds, then one is picked for you.`));
    } else {
      panel.append(el('h2', '', `${nameOf(v.drawer)} is choosing a word`), el('p', 'muted', 'Get ready to guess.'));
    }
  } else if (v.phase === 'over') {
    panel.append(el('h1', '', 'Final scores'));
    const ul = el('ul', 'scores');
    ul.style.width = '100%';
    [...v.scores].sort((a, b) => b[1] - a[1]).forEach(([id, pts], i) => {
      const li = el('li', id === Peiskos.me.id ? 'me' : '');
      li.append(el('span', '', `${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} ${nameOf(id)}`), el('b', '', String(pts)));
      ul.append(li);
    });
    panel.append(ul);
    if (Peiskos.isHost) {
      const again = el('button', 'btn', 'Play again');
      again.type = 'button';
      again.onclick = () => hostLobby();
      panel.append(again);
    } else panel.append(el('p', 'muted small', `${nameOf(Peiskos.hostId)} can start another game.`));
  }
}

// The lobby is built once (the host's options keep their values) and shown again as it was.
const lobbyNodes = [...$('lobby').childNodes];
function renderLobby() {
  const panel = $('lobby');
  if (panel.firstElementChild?.tagName !== 'H1' || panel.firstElementChild.textContent !== 'Sketch & Guess') panel.replaceChildren(...lobbyNodes);
  const people = $('lobbyPlayers');
  people.innerHTML = '';
  for (const p of Peiskos.players) people.append(el('span', `chip${p.id === Peiskos.hostId ? ' host' : ''}`, p.name));
  $('hostOpts').classList.toggle('hidden', !Peiskos.isHost);
  $('btnStart').classList.toggle('hidden', !Peiskos.isHost);
  $('btnStart').disabled = Peiskos.players.length < 2;
  $('lobbyNote').textContent = Peiskos.isHost
    ? Peiskos.players.length < 2 ? 'Waiting for someone to join. Two or more can play.' : 'Take turns drawing. Guess fast for more points.'
    : `Waiting for ${nameOf(Peiskos.hostId)} to start.`;
}

function feed(text, cls = '', by = null) {
  const line = el('div', cls);
  if (by != null) line.append(el('b', '', `${nameOf(by)}: `));
  line.append(document.createTextNode(text));
  const f = $('feed');
  const atEnd = f.scrollTop + f.clientHeight >= f.scrollHeight - 30;
  f.append(line);
  while (f.childElementCount > 200) f.firstElementChild.remove();
  if (atEnd) f.scrollTop = f.scrollHeight;
}

setInterval(() => {
  const c = $('clock');
  if (view.phase !== 'draw' && view.phase !== 'choose') { c.textContent = ''; return; }
  const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  c.textContent = String(left);
  c.classList.toggle('low', left <= 10);
}, 250);

/** What the host says (every copy, the host's own included, takes it here). */
function onView(d) {
  if (d.type === 'state') {
    const before = view;
    view = d.view;
    if (view.phase !== 'lobby') editing = false;
    endsAt = Date.now() + (view.left ?? 0);
    if (before.phase === 'draw' && view.phase === 'reveal') feed(`The word was "${view.word}".`, 'sys');
    if (before.turn !== view.turn && view.phase === 'choose') feed(`${nameOf(view.drawer)} is drawing.`, 'sys');
    // Mid-drawing, this page can't move to its own window (the host's copy says so for itself).
    if (!Peiskos.isHost) Peiskos.busy(isDrawer() && view.phase === 'draw');
    render();
  } else if (d.type === 'feed') feed(String(d.text).slice(0, 200), d.cls || '', d.by ?? null);
  else if (d.type === 'stroke' && d.by !== Peiskos.me.id) sc.add(d.part, d.by);
  else if (d.type === 'remove') sc.remove(d.id);
  else if (d.type === 'clear') sc.clear();
  else if (d.type === 'page') {
    if (d.first) sc.clear();
    for (const s of d.strokes || []) sc.strokes.set(s.id, s);
    sc.redraw();
  }
}

$('guessForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('guess').value.trim();
  if (!text) return;
  $('guess').value = '';
  toHost({ type: 'guess', text: text.slice(0, 60) });
};

// ---------- our words (anyone playing can change them)

let editing = false;
$('btnWords').onclick = async () => {
  editing = true;
  const panel = $('lobby');
  panel.replaceChildren(el('h2', '', 'Our words'), el('p', 'muted small', 'Words for this hearth, one per line. The host picks whether games use them.'));
  const box = el('textarea');
  box.id = 'wordsBox';
  box.disabled = true;
  box.setAttribute('aria-label', 'Our words, one per line');
  const save = el('button', 'btn', 'Save');
  const back = el('button', 'btn secondary', 'Back');
  save.type = back.type = 'button';
  const row = el('div', 'row');
  row.style.justifyContent = 'center';
  row.append(save, back);
  panel.append(box, row);
  back.onclick = () => { editing = false; render(); };
  try {
    box.value = (await Peiskos.api(`/api/servers/${Peiskos.serverId}/game-words`)).words.join('\n');
    box.disabled = false;
    box.focus();
  } catch (err) { showToast(err.message); }
  save.onclick = async () => {
    try {
      const { words } = await Peiskos.api(`/api/servers/${Peiskos.serverId}/game-words`, 'PUT', { words: box.value.split('\n') });
      ourWords = words;
      showToast(`Saved ${words.length} word${words.length === 1 ? '' : 's'}`);
      editing = false;
      render();
    } catch (err) { showToast(err.message); }
  };
};

// ---------- the host's game

let G = null;
let ourWords = [];
let tick = 0;
let saveTimer = 0;

function hostLobby() {
  G = { phase: 'lobby', turn: 0, round: 0, rounds: 3, scores: new Map(Peiskos.players.map((p) => [p.id, 0])), guessed: new Set(), used: new Set() };
  clearInterval(tick);
  Peiskos.busy(false);
  broadcast();
}

function viewFor(id) {
  const v = { phase: G.phase, turn: G.turn, round: G.round, rounds: G.rounds, drawer: G.drawer, scores: [...G.scores], guessed: [...G.guessed], left: Math.max(0, G.endsAt - Date.now()) };
  if (G.phase === 'choose' && id === G.drawer) v.choices = G.choices;
  if (G.phase === 'draw') {
    if (id === G.drawer || G.guessed.has(id)) v.word = G.word;
    v.mask = maskOf(G.word, G.hints);
  }
  if (G.phase === 'reveal') v.word = G.word;
  return v;
}
function broadcast() {
  for (const p of Peiskos.players) {
    const d = { type: 'state', view: viewFor(p.id) };
    if (p.id === Peiskos.me.id) onView(d); else Peiskos.send(p.id, d);
  }
  saveSoon();
}
/** To everyone (the host's copy too). */
function toAll(d) { onView(d); Peiskos.send('all', d); }
function toSome(ids, d) { for (const id of ids) id === Peiskos.me.id ? onView(d) : Peiskos.send(id, d); }

// Letters in any language count (a hearth's own words can be blåbær or jalapeño), so none show through the blanks.
const LETTER = /[\p{L}\p{N}]/u;
const maskOf = (word, hints) => [...word].map((ch, i) => (LETTER.test(ch) && !hints.has(i) ? '_' : ch)).join('');
const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
function near(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length] <= (a.length >= 8 ? 2 : 1);
}

async function hostStart() {
  if (G.phase !== 'lobby' || G.starting) return; // a second tap on Start
  if (Peiskos.players.length < 2) return showToast('Two or more can play.');
  G.starting = true;
  $('btnStart').disabled = true;
  G.rounds = Number($('optRounds').value) || 3;
  G.drawTime = (Number($('optTime').value) || 80) * 1000;
  G.wordsFrom = $('optWords').value;
  try { ourWords = (await Peiskos.api(`/api/servers/${Peiskos.serverId}/game-words`)).words; } catch { /* the pack still works */ }
  G.starting = false;
  if (G.phase !== 'lobby') return;
  if (G.wordsFrom === 'ours' && ourWords.length < 3) { G.wordsFrom = 'mix'; showToast('Your hearth has fewer than three words, so the pack is in too.'); }
  G.scores = new Map(Peiskos.players.map((p) => [p.id, 0]));
  G.used = new Set();
  G.round = 0;
  nextRound();
}

function nextRound() {
  G.round++;
  if (G.round > G.rounds) return gameOver();
  G.queue = Peiskos.players.map((p) => p.id);
  nextTurn();
}

function nextTurn() {
  const here = new Set(Peiskos.players.map((p) => p.id));
  if (here.size < 2) return gameOver();
  G.queue = G.queue.filter((id) => here.has(id));
  if (!G.queue.length) return nextRound();
  G.drawer = G.queue.shift();
  G.turn++;
  G.phase = 'choose';
  G.guessed = new Set();
  G.hints = new Set();
  G.word = null;
  G.choices = pickWords(3);
  G.endsAt = Date.now() + CHOOSE_SECONDS * 1000;
  clearInterval(tick);
  tick = setInterval(hostTick, 300);
  Peiskos.busy(true);
  broadcast();
}

function pickWords(n) {
  const pool = (G.wordsFrom === 'ours' ? ourWords : G.wordsFrom === 'pack' ? WORDS : [...WORDS, ...ourWords, ...ourWords]).filter((w) => norm(w));
  // A word with no letters (an emoji saved before words needed one) can't be hidden or guessed.
  let fresh = pool.filter((w) => !G.used.has(w) && LETTER.test(w));
  if (fresh.length < n) { G.used.clear(); fresh = pool.filter((w) => LETTER.test(w)); }
  const out = [];
  while (out.length < n && fresh.length) {
    const w = fresh.splice(Math.floor(Math.random() * fresh.length), 1)[0];
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

function startDrawing(word) {
  G.word = word;
  G.used.add(word);
  G.phase = 'draw';
  G.started = Date.now();
  G.endsAt = Date.now() + G.drawTime;
  toAll({ type: 'clear' });
  broadcast();
}

function hostTick() {
  const now = Date.now();
  if (G.phase === 'choose' && now >= G.endsAt) return startDrawing(G.choices[0]);
  if (G.phase === 'draw') {
    if (now >= G.endsAt) return endTurn();
    // Hints: a letter at half time and another at three quarters (never more than a third of the word).
    const spent = (now - G.started) / G.drawTime;
    const letters = [...G.word].map((ch, i) => (LETTER.test(ch) ? i : -1)).filter((i) => i >= 0 && !G.hints.has(i));
    const want = (spent >= 0.5 ? 1 : 0) + (spent >= 0.75 ? 1 : 0);
    if (G.hints.size < want && letters.length > 1 && G.hints.size < Math.floor([...G.word].filter((ch) => LETTER.test(ch)).length / 3)) {
      G.hints.add(letters[Math.floor(Math.random() * letters.length)]);
      broadcast();
    }
  }
  if (G.phase === 'reveal' && now >= G.endsAt) nextTurn();
}

function endTurn() {
  if (G.phase !== 'draw' && G.phase !== 'choose') return;
  if (G.phase === 'choose') G.word = G.choices[0];
  G.phase = 'reveal';
  G.endsAt = Date.now() + REVEAL_SECONDS * 1000;
  // Still busy: popping out between turns would reload the host's copy and send everyone to the lobby.
  broadcast();
}

function gameOver() {
  clearInterval(tick);
  G.phase = 'over';
  Peiskos.busy(false);
  broadcast();
}

function hostGuess(from, text) {
  text = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!text) return;
  // Once you know the word (you drew it or guessed it), what you say goes only to the others who know it.
  if (G.phase !== 'draw' || from === G.drawer || G.guessed.has(from)) {
    if (G.phase === 'draw' && norm(text).includes(norm(G.word))) return;
    const knowing = G.phase === 'draw' ? [G.drawer, ...G.guessed] : Peiskos.players.map((p) => p.id);
    return toSome(knowing, { type: 'feed', by: from, text });
  }
  if (norm(text) === norm(G.word)) {
    const left = Math.max(0, G.endsAt - Date.now());
    const pts = 100 + Math.round(200 * (left / G.drawTime)) + Math.max(0, 30 - G.guessed.size * 10);
    G.scores.set(from, (G.scores.get(from) ?? 0) + pts);
    G.scores.set(G.drawer, (G.scores.get(G.drawer) ?? 0) + 40);
    G.guessed.add(from);
    toAll({ type: 'feed', by: from, text: `got it (+${pts})`, cls: 'right' });
    const guessers = Peiskos.players.filter((p) => p.id !== G.drawer);
    if (guessers.every((p) => G.guessed.has(p.id))) return endTurn();
    return broadcast();
  }
  // A close guess is all but the word, so only the guesser and whoever knows the word see it.
  if (near(norm(text), norm(G.word))) {
    toSome([from], { type: 'feed', text: `"${text}" is close!`, cls: 'close' });
    return toSome([G.drawer, ...G.guessed], { type: 'feed', by: from, text });
  }
  toAll({ type: 'feed', by: from, text });
}

function hostStroke(by, part) {
  if (G?.phase !== 'draw' || by !== G.drawer || !part || typeof part.id !== 'string' || !Array.isArray(part.points)) return;
  if (part.fill && by !== Peiskos.me.id && fillTooFast(by)) return;
  part = { id: part.id.slice(0, 24), color: String(part.color).slice(0, 9), size: Math.min(60, Math.max(1, Number(part.size) || 10)), erase: !!part.erase && !part.fill, fill: !!part.fill, points: part.points.slice(0, part.fill ? 1 : 400) };
  if (by !== Peiskos.me.id) sc.add(part, by);
  Peiskos.send('all', { type: 'stroke', by, part });
}

function sendPage(to) {
  let batch = [];
  let size = 0;
  let first = true;
  const out = () => { Peiskos.send(to, { type: 'page', strokes: batch, first }); first = false; batch = []; size = 0; };
  for (const s of sc.all()) {
    const n = JSON.stringify(s).length;
    if (size + n > BATCH && batch.length) out();
    if (n <= BATCH) { batch.push(s); size += n; }
  }
  out();
}

function hostMsg(from, d) {
  if (!G) return;
  if (d.type === 'hello') {
    if (!G.scores.has(from)) G.scores.set(from, 0);
    Peiskos.send(from, { type: 'state', view: viewFor(from) });
    if (G.phase === 'draw' || G.phase === 'reveal') sendPage(from);
  } else if (d.type === 'guess') hostGuess(from, d.text);
  else if (d.type === 'pick' && G.phase === 'choose' && from === G.drawer) startDrawing(G.choices[Number(d.i)] ?? G.choices[0]);
  else if (d.type === 'stroke') hostStroke(from, d.part);
  else if (from === G.drawer && G.phase === 'draw' && d.type === 'clear') {
    if (from !== Peiskos.me.id) sc.clear();
    Peiskos.send('all', { type: 'clear' });
  } else if (from === G.drawer && G.phase === 'draw' && d.type === 'undo') {
    const id = String(d.id).slice(0, 24);
    const s = sc.strokes.get(id);
    // The host's own copy has already taken its stroke off the page by the time this runs.
    if (from === Peiskos.me.id ? !s || s.by == null : s?.by === from) { sc.remove(id); Peiskos.send('all', { type: 'remove', id }); }
  }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => Peiskos.snapshot({ scores: [...G.scores] }), 1000);
}

Peiskos.on('msg', (from, d) => {
  if (Peiskos.isHost) return hostMsg(from, d);
  if (from === Peiskos.hostId) onView(d);
});

Peiskos.on('players', (players) => {
  if (!Peiskos.isHost) { if (view.phase === 'lobby') render(); return; }
  for (const p of players) if (!G.scores.has(p.id)) G.scores.set(p.id, 0);
  const here = new Set(players.map((p) => p.id));
  if (G.phase === 'lobby') { G.scores = new Map(players.map((p) => [p.id, G.scores.get(p.id) ?? 0])); return broadcast(); }
  if ((G.phase === 'choose' || G.phase === 'draw') && !here.has(G.drawer)) {
    toAll({ type: 'feed', text: `${nameOf(G.drawer)} left, so that turn's over.`, cls: 'sys' });
    return endTurn();
  }
  if (here.size < 2 && G.phase !== 'over') return gameOver();
  if (G.phase === 'draw' && players.filter((p) => p.id !== G.drawer).every((p) => G.guessed.has(p.id))) return endTurn();
  broadcast();
});

Peiskos.on('init', (resume) => {
  $('btnLeave').textContent = Peiskos.isHost ? 'End' : 'Leave';
  $('btnLeave').title = Peiskos.isHost ? 'Ends the game for everyone' : '';
  if (Peiskos.isHost) {
    hostLobby();
    if (resume && Array.isArray(resume.scores)) { for (const [id, pts] of resume.scores) G.scores.set(id, pts); broadcast(); }
    Peiskos.api(`/api/servers/${Peiskos.serverId}/game-words`).then((r) => { ourWords = r.words; }, () => {});
  } else Peiskos.send(Peiskos.hostId, { type: 'hello' });
  render();
});

$('btnStart').onclick = hostStart;
$('btnLeave').onclick = () => {
  if (Peiskos.isHost && G && G.phase !== 'lobby' && G.phase !== 'over' && !confirm('End the game for everyone?')) return;
  Peiskos.leave();
};
