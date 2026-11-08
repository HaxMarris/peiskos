/* FIRESIDE TRIVIA: questions everyone answers at once; faster right answers score more.
   The host's copy asks Peiskos for a round of questions (ones this hearth hasn't had yet) and keeps
   the answers to itself until everyone has answered or time is up. */
'use strict';

const QUESTION_SECONDS = 15;
const REVEAL_SECONDS = 5;
const BONUS = { easy: 0, medium: 20, hard: 40 };

let view = { phase: 'lobby', scores: [] };
let endsAt = 0;
let picked = null;
let screen = 'game'; // or 'own' (the hearth's own questions)
const panel = $('panel');

function btn(text, cls = 'btn', onclick) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onclick) b.onclick = onclick;
  return b;
}
const toHost = (d) => (Peiskos.isHost ? hostMsg(Peiskos.me.id, d) : Peiskos.send(Peiskos.hostId, d));
const sorted = (scores) => [...scores].sort((a, b) => b[1] - a[1]);

function scoreList(scores) {
  const ul = el('ul', 'scores');
  sorted(scores).forEach(([id, pts], i) => {
    const li = el('li', id === Peiskos.me.id ? 'me' : '');
    li.append(el('span', '', `${view.phase === 'over' ? (['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`) + ' ' : ''}${nameOf(id)}`), el('b', '', String(pts)));
    ul.append(li);
  });
  return ul;
}

// Each update redraws the panel; where you'd scrolled to and what had focus stay put while the screen is the same one.
let shown = '';
function render() {
  if (screen === 'own') return;
  const key = `${view.phase}:${view.index ?? ''}`;
  const controls = () => [...panel.querySelectorAll('button, input, select')];
  const keep = key === shown ? { top: panel.scrollTop, cats: panel.querySelector('.cats')?.scrollTop ?? 0, focus: controls().indexOf(document.activeElement) } : null;
  shown = key;
  draw();
  if (!keep) return;
  panel.scrollTop = keep.top;
  const cats = panel.querySelector('.cats');
  if (cats) cats.scrollTop = keep.cats;
  if (keep.focus >= 0) controls()[keep.focus]?.focus({ preventScroll: true });
}
function draw() {
  const v = view;
  panel.innerHTML = '';
  if (v.phase === 'lobby') return renderLobby();
  if (v.phase === 'loading') { panel.append(el('h2', '', 'Getting the questions…')); return; }
  if (v.phase === 'over') {
    panel.append(el('h1', '', 'Final scores'), scoreList(v.scores));
    if (v.credits?.length) panel.append(el('p', 'credit', v.credits.join(' · ')));
    if (Peiskos.isHost) panel.append(btn('Back to the lobby', 'btn', hostLobby));
    else panel.append(el('p', 'muted small', `${nameOf(Peiskos.hostId)} can start another round.`));
    return;
  }
  const q = v.q;
  const top = el('div', 'top');
  top.append(el('span', 'muted', `Question ${v.index + 1} of ${v.total}`), el('span', 'muted', `${q.category} · ${q.difficulty}`));
  const bar = el('div', 'bar');
  const fill = el('span');
  fill.id = 'fill';
  bar.append(fill);
  const answers = el('div', `answers${q.answers.length === 2 ? ' tf' : ''}`);
  q.answers.forEach((a, i) => {
    const b = btn(a, 'answer');
    if (v.phase === 'question') {
      b.disabled = picked !== null;
      b.onclick = () => { picked = i; toHost({ type: 'answer', index: v.index, choice: i }); render(); };
      if (picked === i) b.classList.add('picked');
    } else {
      b.disabled = true;
      if (i === v.correct) b.classList.add('right');
      else if (picked === i) b.classList.add('wrong');
      const who = (v.picks ?? []).filter(([, c]) => c === i).map(([id]) => nameOf(id));
      if (who.length) b.append(el('span', 'who', who.join(', ')));
    }
    answers.append(b);
  });
  const gain = el('div');
  gain.id = 'gain';
  if (v.phase === 'question') gain.textContent = `${v.answered} of ${v.players} answered`;
  else {
    const mine = (v.gains ?? []).find(([id]) => id === Peiskos.me.id);
    gain.textContent = mine ? `+${mine[1]}` : picked === null ? 'Too slow' : 'Not this time';
  }
  panel.append(top, bar, questionText(q.question), answers, gain);
  if (v.phase === 'reveal') panel.append(scoreList(v.scores));
}
const say = (text) => { $('say').textContent = text; };
function questionText(text) { const h = el('h2', '', text); h.id = 'question'; return h; }

setInterval(() => {
  const fill = $('fill');
  if (!fill) return;
  const left = view.phase === 'question' ? Math.max(0, endsAt - Date.now()) : 0;
  fill.style.width = `${(left / (QUESTION_SECONDS * 1000)) * 100}%`;
}, 200);

// ---------- the lobby (the host picks what to play)

let categories = null;
const chosen = { cats: new Set(), count: 10, difficulty: '' };

async function loadCategories() {
  try { categories = await Peiskos.api(`/api/trivia/categories?serverId=${Peiskos.serverId}`); } catch (err) { showToast(err.message); categories = { categories: [], total: 0 }; }
  render();
}

function renderLobby() {
  panel.append(el('h1', '', 'Fireside Trivia'));
  const people = el('div', 'players');
  for (const p of Peiskos.players) people.append(el('span', `chip${p.id === Peiskos.hostId ? ' host' : ''}`, p.name));
  panel.append(people);
  if (view.scores.some(([, pts]) => pts)) panel.append(el('p', 'muted small', 'Scores from the last round are kept until a new one starts.'));
  if (!Peiskos.isHost) {
    panel.append(el('p', 'muted', `Waiting for ${nameOf(Peiskos.hostId)} to start. ${QUESTION_SECONDS} seconds a question; answer fast for more points.`));
  } else if (!categories) {
    panel.append(el('p', 'muted', 'Getting the categories…'));
  } else {
    panel.append(el('p', 'muted small', `${categories.total.toLocaleString()} questions. Pick categories, or leave them all off for a mix.`));
    const cats = el('div', 'cats');
    for (const c of categories.categories) {
      const label = el('label');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = chosen.cats.has(c.name);
      box.onchange = () => { box.checked ? chosen.cats.add(c.name) : chosen.cats.delete(c.name); };
      label.append(box, el('span', '', c.name), el('span', 'n', String(c.count)));
      cats.append(label);
    }
    const opts = el('div', 'opts');
    const count = el('select');
    count.id = 'optCount';
    for (const n of [5, 10, 15, 20, 30]) { const o = el('option', '', String(n)); o.value = n; o.selected = n === chosen.count; count.append(o); }
    count.onchange = () => { chosen.count = Number(count.value); };
    const diff = el('select');
    diff.id = 'optDiff';
    for (const [v, t] of [['', 'Any'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']]) { const o = el('option', '', t); o.value = v; o.selected = v === chosen.difficulty; diff.append(o); }
    diff.onchange = () => { chosen.difficulty = diff.value; };
    const l1 = el('label', '', 'Questions'); l1.htmlFor = 'optCount';
    const l2 = el('label', '', 'Difficulty'); l2.htmlFor = 'optDiff';
    opts.append(l1, count, l2, diff);
    panel.append(cats, opts);
  }
  const row = el('div', 'row');
  if (Peiskos.isHost) {
    const start = btn('Start', 'btn', hostStart);
    start.disabled = !categories;
    row.append(start);
  }
  row.append(btn('Our questions', 'btn secondary', openOwn), btn(Peiskos.isHost ? 'End' : 'Leave', 'link', () => Peiskos.leave()));
  panel.append(row);
}

// ---------- the hearth's own questions (anyone playing can add them)

async function openOwn() {
  screen = 'own';
  panel.replaceChildren(el('h2', '', 'Our questions'), el('p', 'muted small', 'Questions about your own group. They come up under "Our hearth".'));
  const list = el('ul', 'own');
  const form = el('div', 'form');
  const field = (label, max) => { const i = el('input'); i.maxLength = max; i.placeholder = label; i.setAttribute('aria-label', label); return i; };
  const q = field('Question', 300);
  const a = field('Right answer', 100);
  const w = [field('Wrong answer', 100), field('Another wrong answer (optional)', 100), field('One more (optional)', 100)];
  const add = btn('Add question', 'btn', async () => {
    try {
      const r = await Peiskos.api(`/api/servers/${Peiskos.serverId}/trivia`, 'POST', { question: q.value, answer: a.value, wrong: w.map((x) => x.value) });
      for (const x of [q, a, ...w]) x.value = '';
      fill(r);
      showToast('Question added');
      categories = null;
      if (Peiskos.isHost) loadCategories();
    } catch (err) { showToast(err.message); }
  });
  form.append(q, a, ...w, add);
  panel.append(form, list, btn('Back', 'btn secondary', () => { screen = 'game'; shown = ''; render(); }));
  const fill = ({ questions }) => {
    list.innerHTML = '';
    if (!questions.length) list.append(el('li', 'muted', 'None yet.'));
    for (const item of questions) {
      const li = el('li');
      li.append(el('span', '', `${item.question} (${item.answer})`));
      if (item.mine) li.append(btn('Remove', 'link', async () => {
        try { fill(await Peiskos.api(`/api/servers/${Peiskos.serverId}/trivia/${item.id}`, 'DELETE')); } catch (err) { showToast(err.message); }
      }));
      list.append(li);
    }
  };
  try { fill(await Peiskos.api(`/api/servers/${Peiskos.serverId}/trivia`)); } catch (err) { showToast(err.message); }
}

// ---------- what the host says

function onView(d) {
  if (d.type !== 'state') return;
  const before = view;
  view = d.view;
  endsAt = Date.now() + (view.left ?? 0);
  if (view.phase === 'question' && (before.phase !== 'question' || before.index !== view.index)) picked = view.mine ?? null;
  // The panel is redrawn with every answer that comes in, so screen readers hear only what's new: the question, then how it went.
  if (view.phase === 'question' && before.index !== view.index) say(`Question ${view.index + 1}. ${view.q.question}`);
  else if (view.phase === 'reveal' && before.phase !== 'reveal') {
    const mine = (view.gains ?? []).find(([id]) => id === Peiskos.me.id);
    say(`${mine ? `Right, plus ${mine[1]}` : picked === null ? 'Too slow' : 'Not this time'}. The answer was ${view.q.answers[view.correct]}.`);
  }
  // A round starting takes you back from your questions to the game.
  if (view.phase !== 'lobby' && before.phase === 'lobby' && screen === 'own') screen = 'game';
  render();
}

// ---------- the host's game

let G = null;
let tick = 0;

function hostLobby() {
  clearInterval(tick);
  G = { phase: 'lobby', scores: new Map(Peiskos.players.map((p) => [p.id, G?.scores.get(p.id) ?? 0])) };
  Peiskos.busy(false);
  broadcast();
}

function viewFor(id) {
  const v = { phase: G.phase, scores: [...G.scores] };
  if (G.phase === 'question' || G.phase === 'reveal') {
    const q = G.questions[G.index];
    Object.assign(v, {
      index: G.index, total: G.questions.length, left: Math.max(0, G.endsAt - Date.now()),
      q: { category: q.category, difficulty: q.difficulty, question: q.question, answers: q.answers },
      answered: G.picks.size, players: Peiskos.players.length,
    });
    if (G.picks.has(id)) v.mine = G.picks.get(id).choice;
    if (G.phase === 'reveal') Object.assign(v, { correct: q.correct, picks: [...G.picks].map(([pid, p]) => [pid, p.choice]), gains: G.gains });
  }
  if (G.phase === 'over') v.credits = G.credits;
  return v;
}
function broadcast() {
  for (const p of Peiskos.players) {
    const d = { type: 'state', view: viewFor(p.id) };
    if (p.id === Peiskos.me.id) onView(d); else Peiskos.send(p.id, d);
  }
  Peiskos.snapshot({ scores: [...G.scores] });
}

async function hostStart() {
  if (G.phase !== 'lobby') return; // a second tap on Start
  G.phase = 'loading';
  broadcast();
  try {
    const round = await Peiskos.api('/api/trivia/round', 'POST', { serverId: Peiskos.serverId, count: chosen.count, categories: [...chosen.cats], difficulty: chosen.difficulty || null });
    G.questions = round.questions;
    G.credits = round.credits;
  } catch (err) {
    showToast(err.message);
    return hostLobby();
  }
  G.scores = new Map(Peiskos.players.map((p) => [p.id, 0]));
  G.index = -1;
  Peiskos.busy(true);
  nextQuestion();
  clearInterval(tick);
  tick = setInterval(hostTick, 250);
}

function nextQuestion() {
  G.index++;
  if (G.index >= G.questions.length) {
    clearInterval(tick);
    G.phase = 'over';
    Peiskos.busy(false);
    return broadcast();
  }
  G.phase = 'question';
  G.picks = new Map();
  G.started = Date.now();
  G.endsAt = G.started + QUESTION_SECONDS * 1000;
  broadcast();
}

function reveal() {
  const q = G.questions[G.index];
  G.gains = [];
  for (const [id, p] of G.picks) {
    if (p.choice !== q.correct) continue;
    const left = Math.max(0, QUESTION_SECONDS * 1000 - p.after) / (QUESTION_SECONDS * 1000);
    const pts = 50 + Math.round(50 * left) + (BONUS[q.difficulty] ?? 0);
    G.gains.push([id, pts]);
    G.scores.set(id, (G.scores.get(id) ?? 0) + pts);
  }
  G.phase = 'reveal';
  G.endsAt = Date.now() + REVEAL_SECONDS * 1000;
  broadcast();
}

function hostTick() {
  if (G.phase === 'question' && Date.now() >= G.endsAt) reveal();
  else if (G.phase === 'reveal' && Date.now() >= G.endsAt) nextQuestion();
}

function hostMsg(from, d) {
  if (!G) return;
  if (d.type === 'hello') {
    if (!G.scores.has(from)) G.scores.set(from, 0);
    Peiskos.send(from, { type: 'state', view: viewFor(from) });
  } else if (d.type === 'answer' && G.phase === 'question' && d.index === G.index && !G.picks.has(from)) {
    const choice = Number(d.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= G.questions[G.index].answers.length) return;
    G.picks.set(from, { choice, after: Date.now() - G.started });
    if (Peiskos.players.every((p) => G.picks.has(p.id))) reveal(); else broadcast();
  }
}

Peiskos.on('msg', (from, d) => {
  if (Peiskos.isHost) return hostMsg(from, d);
  if (from === Peiskos.hostId) onView(d);
});

Peiskos.on('players', (players) => {
  if (!Peiskos.isHost) { if (view.phase === 'lobby') render(); return; }
  for (const p of players) if (!G.scores.has(p.id)) G.scores.set(p.id, 0);
  if (G.phase === 'question' && G.picks.size && players.every((p) => G.picks.has(p.id))) return reveal();
  broadcast();
});

Peiskos.on('init', (resume) => {
  if (Peiskos.isHost) {
    hostLobby();
    if (resume && Array.isArray(resume.scores)) { for (const [id, pts] of resume.scores) G.scores.set(id, pts); broadcast(); }
    loadCategories();
  } else Peiskos.send(Peiskos.hostId, { type: 'hello' });
  render();
});

// Leaving is in Peiskos's game bar; the host ending the game ends it for everyone.
