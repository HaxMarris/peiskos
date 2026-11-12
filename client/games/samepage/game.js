/* SAME PAGE: a prompt comes up, everyone answers in secret, and you score a point for every friend
   who wrote the same thing. The host's copy keeps the answers to itself until everyone has answered
   or time is up. */
'use strict';

const ANSWER_SECONDS = 30;
const REVEAL_SECONDS = 10;
const ANSWER_MAX = 40;

let view = { phase: 'lobby', scores: [] };
const chosen = { count: 10 };
const panel = $('panel');

const toHost = (d) => (Peiskos.isHost ? hostMsg(Peiskos.me.id, d) : Peiskos.send(Peiskos.hostId, d));
const isMe = (id) => id === Peiskos.me.id;
const names = (ids) => ids.map((id) => (isMe(id) ? 'You' : nameOf(id))).join(', ');

/** What two answers must share to count as the same: "The Pancakes" and "pancake" do. */
function matchKey(text) {
  const key = plain(String(text).replace(/^\s*(a|an|the|some)\s+/i, ''));
  return key.length > 3 && key.endsWith('s') && !key.endsWith('ss') ? key.slice(0, -1) : key;
}

function render() { redraw(panel, `${view.phase}:${view.index ?? ''}`, draw); }

function draw() {
  const v = view;
  if (v.phase === 'lobby') return drawLobby();
  if (v.phase === 'over') {
    panel.append(el('h1', '', 'Final scores'), scoreList(v.scores, true));
    if (Peiskos.isHost) panel.append(btn('Back to the lobby', 'btn', hostLobby));
    else panel.append(el('p', 'muted small', `${nameOf(Peiskos.hostId)} can start another game.`));
    return;
  }
  panel.append(...clockRow(`Prompt ${v.index + 1} of ${v.count}`));
  const ask = el('h2', '', v.ask);
  ask.id = 'ask';
  panel.append(ask);

  if (v.phase === 'answer') {
    if (v.mine == null) {
      panel.append(composer('answer', 'Your answer', ANSWER_MAX, 'Send answer', (text) => {
        const answer = tidy(text, ANSWER_MAX);
        if (!plain(answer)) return showToast('Type an answer.');
        toHost({ type: 'answer', index: v.index, answer });
      }));
      panel.append(el('p', 'note muted', `Write what you think the others will write. ${v.answered} of ${v.players} have answered.`));
    } else {
      const sent = el('p', 'sent');
      sent.append(el('span', 'muted small', 'Your answer '), el('b', '', v.mine));
      panel.append(sent, el('p', 'note muted', `${v.answered} of ${v.players} have answered.`));
    }
    return;
  }

  // The reveal: the most-shared answers first.
  const pages = el('ul', 'pages');
  for (const g of v.groups) {
    const n = g.ids.length;
    const li = el('li', `page ${n > 1 ? 'shared' : 'alone'}${g.ids.some(isMe) ? ' mine' : ''}`);
    li.style.setProperty('--n', String(Math.min(n, 6)));
    li.append(el('span', 'said', g.text), el('span', 'pts', n > 1 ? `+${n - 1} each` : 'no match'), el('span', 'names', names(g.ids)));
    pages.append(li);
  }
  if (!v.groups.length) pages.append(el('li', 'page alone', 'Nobody answered.'));
  panel.append(pages);
  if (v.quiet.length) panel.append(el('p', 'note muted small', `No answer from ${v.quiet.map((id) => (isMe(id) ? 'you' : nameOf(id))).join(', ')}.`));
  panel.append(el('p', 'note', mineLine(v)), scoreList(v.scores));
}

function mineLine(v) {
  const mine = v.groups.find((g) => g.ids.some(isMe));
  if (!mine) return 'You didn\'t answer in time.';
  const n = mine.ids.length - 1;
  return n ? `${n} ${n === 1 ? 'friend' : 'friends'} wrote the same as you. +${n}` : 'Nobody else wrote that.';
}

function drawLobby() {
  panel.append(el('h1', '', 'Same Page'), playerChips());
  panel.append(el('p', 'how muted', `A prompt comes up and everyone answers in secret, with ${ANSWER_SECONDS} seconds on the clock. You score a point for every friend who wrote the same thing as you. Spelling has to match, but capitals, "the" and a plural s don't.`));
  const few = Peiskos.players.length < 2;
  if (Peiskos.isHost) {
    const opts = el('div', 'opts');
    opts.append(...choice('optCount', 'Prompts', [[5, '5'], [10, '10'], [15, '15'], [20, '20']], chosen.count, (n) => { chosen.count = n; }));
    panel.append(opts);
    if (few) panel.append(el('p', 'note muted', 'Same Page needs 2 players. Waiting for someone to join.'));
  } else {
    panel.append(el('p', 'note muted', `Waiting for ${nameOf(Peiskos.hostId)} to start.`));
  }
  const row = el('div', 'row');
  if (Peiskos.isHost) {
    const start = btn('Start', 'btn', hostStart);
    start.disabled = few;
    row.append(start);
  }
  row.append(btn(Peiskos.isHost ? 'End' : 'Leave', 'link', () => Peiskos.leave()));
  panel.append(row);
}

// ---------- what the host says

function onView(d) {
  if (d.type !== 'state') return;
  const before = view;
  const v = view = d.view;
  setClock(v.left, v.total);
  const fresh = before.phase !== v.phase || before.index !== v.index;
  if (v.phase === 'answer' && fresh) say(`Prompt ${v.index + 1}. ${v.ask}`);
  else if (v.phase === 'reveal' && fresh) {
    const top = v.groups[0];
    say(`${mineLine(v)}${top && top.ids.length > 1 ? ` Most common: ${top.text}, from ${names(top.ids)}.` : ''}`);
  }
  render();
}

// ---------- the host's game

let G = null;
let tick = 0;
let deck = [];

const setEnds = (seconds) => { G.total = seconds * 1000; G.endsAt = Date.now() + G.total; };

function hostLobby() {
  clearInterval(tick);
  G = { phase: 'lobby', scores: new Map(Peiskos.players.map((p) => [p.id, G?.scores.get(p.id) ?? 0])) };
  Peiskos.busy(false);
  broadcast();
}

function viewFor(id) {
  const v = { phase: G.phase, scores: [...G.scores] };
  if (G.phase === 'lobby' || G.phase === 'over') return v;
  Object.assign(v, { index: G.index, count: G.count, ask: G.ask, left: Math.max(0, G.endsAt - Date.now()), total: G.total });
  if (G.phase === 'answer') Object.assign(v, { answered: G.answers.size, players: Peiskos.players.length, mine: G.answers.get(id) ?? null });
  else Object.assign(v, { groups: G.groups, quiet: G.quiet });
  return v;
}

function hostStart() {
  if (G.phase !== 'lobby' || Peiskos.players.length < 2) return;
  G.scores = new Map(Peiskos.players.map((p) => [p.id, 0]));
  G.count = chosen.count;
  G.index = -1;
  Peiskos.busy(true);
  clearInterval(tick);
  tick = setInterval(hostTick, 250);
  nextPrompt();
}

function nextPrompt() {
  G.index++;
  if (G.index >= G.count) {
    clearInterval(tick);
    G.phase = 'over';
    Peiskos.busy(false);
    return broadcast();
  }
  if (!deck.length) deck = shuffle(PROMPTS.map((_, i) => i));
  G.ask = PROMPTS[deck.pop()];
  G.answers = new Map();
  G.phase = 'answer';
  setEnds(ANSWER_SECONDS);
  broadcast();
}

function reveal() {
  const byKey = new Map();
  for (const [id, text] of G.answers) {
    const key = matchKey(text);
    if (!byKey.has(key)) byKey.set(key, { text, ids: [] });
    byKey.get(key).ids.push(id);
  }
  G.groups = [...byKey.values()].sort((a, b) => b.ids.length - a.ids.length);
  G.quiet = Peiskos.players.map((p) => p.id).filter((id) => !G.answers.has(id));
  for (const g of G.groups) for (const id of g.ids) G.scores.set(id, (G.scores.get(id) ?? 0) + g.ids.length - 1);
  G.phase = 'reveal';
  setEnds(REVEAL_SECONDS);
  broadcast();
}

function hostTick() {
  if (Date.now() < G.endsAt) return;
  if (G.phase === 'answer') reveal();
  else if (G.phase === 'reveal') nextPrompt();
}

function hostMsg(from, d) {
  if (!G) return;
  if (hello(from, d)) return;
  if (d.type === 'answer' && G.phase === 'answer' && d.index === G.index && !G.answers.has(from)) {
    const answer = tidy(d.answer, ANSWER_MAX);
    if (!plain(answer)) return;
    G.answers.set(from, answer);
    if (Peiskos.players.every((p) => G.answers.has(p.id))) reveal(); else broadcast();
  }
}

Peiskos.on('players', (players) => {
  if (!Peiskos.isHost) { if (view.phase === 'lobby') render(); return; }
  for (const p of players) if (!G.scores.has(p.id)) G.scores.set(p.id, 0);
  if (G.phase === 'answer' && G.answers.size && players.every((p) => G.answers.has(p.id))) return reveal();
  broadcast();
});

// Sending each player their view, late joiners, and picking the scores back up are the same in
// every party game (shared/party.js).
const { broadcast, hello } = partyHost({ state: () => G, viewFor, onView, hostMsg, hostLobby, render });

// Leaving is in Peiskos's game bar; the host ending the game ends it for everyone.
