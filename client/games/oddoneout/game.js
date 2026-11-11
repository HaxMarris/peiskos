/* ODD ONE OUT: everyone gets the same secret word except one person, whose word is a close cousin.
   Nobody is told which they have. Each gives one-word clues in turn, then everyone votes on who's
   off. The host's copy deals the words and keeps the votes; each player is sent only their own word
   until the round is over. */
'use strict';

const MIN_PLAYERS = 3;
const CLUE_SECONDS = 30;
const VOTE_SECONDS = 60;
const GUESS_SECONDS = 25;
const REVEAL_SECONDS = 10;
const CLUE_MAX = 24;
const POINTS = { caught: 2, spotted: 1, away: 3, guessed: 2 };

let view = { phase: 'lobby', scores: [] };
const chosen = { rounds: 5, clues: 2 };
const panel = $('panel');

const toHost = (d) => (Peiskos.isHost ? hostMsg(Peiskos.me.id, d) : Peiskos.send(Peiskos.hostId, d));
const isMe = (id) => id === Peiskos.me.id;
const who = (id) => (isMe(id) ? 'You' : nameOf(id));

/** A clue is one word, and not the word it's a clue for. */
function clueProblem(clue, word) {
  if (!plain(clue)) return 'Type a one-word clue.';
  if (/\s/.test(clue)) return 'One word only.';
  const c = plain(clue);
  const w = plain(word);
  if (c.includes(w) || (c.length >= 3 && w.includes(c))) return "Your clue can't be the word itself.";
  return '';
}

function render() { redraw(panel, `${view.phase}:${view.round ?? ''}:${view.turn ?? ''}`, draw); }

function draw() {
  const v = view;
  if (v.phase === 'lobby') return drawLobby();
  if (v.phase === 'over') {
    panel.append(el('h1', '', 'Final scores'), scoreList(v.scores, true));
    if (Peiskos.isHost) panel.append(btn('Back to the lobby', 'btn', hostLobby));
    else panel.append(el('p', 'muted small', `${nameOf(Peiskos.hostId)} can start another game.`));
    return;
  }
  panel.append(...clockRow(`Round ${v.round + 1} of ${v.rounds}`));

  // The slip: your word while the round is on, both words once it's over.
  if (v.phase === 'reveal') {
    const slip = el('div', 'slip pair');
    const half = (label, word) => { const d = el('div'); d.append(el('small', '', label), el('strong', '', word)); return d; };
    slip.append(half('Everyone else had', v.words.main), half(`${who(v.oddId)} had`, v.words.odd));
    panel.append(slip);
  } else if (v.playing) {
    const slip = el('div', 'slip');
    slip.append(el('small', '', 'Your word'), el('strong', '', v.word));
    panel.append(slip);
  } else {
    panel.append(el('p', 'note muted', "You're watching this round. You get a word in the next one."));
  }

  panel.append(note(v), seats(v));

  if (v.phase === 'clue' && isMe(v.turn)) {
    panel.append(composer('clue', 'Your one-word clue', CLUE_MAX, 'Give clue', (text) => {
      const clue = tidy(text, CLUE_MAX);
      const problem = clueProblem(clue, v.word);
      if (problem) return showToast(problem);
      toHost({ type: 'clue', round: v.round, clue });
    }));
  } else if (v.phase === 'guess' && isMe(v.oddId)) {
    panel.append(composer('guess', "Everyone else's word", 40, 'Guess', (text) => {
      const guess = tidy(text, 40);
      if (!plain(guess)) return showToast('Type your guess.');
      toHost({ type: 'guess', round: v.round, guess });
    }));
  }
  if (v.phase === 'reveal') panel.append(scoreList(v.scores));
}

/** The line that says what's happening and what you do now. */
function note(v) {
  const p = el('p', 'note');
  if (v.phase === 'clue') {
    if (isMe(v.turn)) p.textContent = 'Your turn. Give a clue that shows you know the word without handing it to the odd one out.';
    else p.textContent = `${nameOf(v.turn)} is giving a clue.`;
  } else if (v.phase === 'vote') {
    if (!v.playing) p.textContent = `${v.voted} of ${v.voters} have voted.`;
    else if (v.mine == null) p.textContent = 'Whose clues don\'t fit your word? Pick one. If everyone else\'s seem off, the odd one out may be you.';
    else p.textContent = `You voted for ${nameOf(v.mine)}. ${v.voted} of ${v.voters} have voted.`;
  } else if (v.phase === 'guess') {
    if (isMe(v.oddId)) p.textContent = `You were the odd one out and got away with it. Guess everyone else's word for ${POINTS.guessed} more points.`;
    else p.textContent = `${nameOf(v.oddId)} was the odd one out and got away with it. They get one guess at your word.`;
  } else if (v.phase === 'reveal') {
    let text;
    if (v.gone) text = 'The odd one out left, so nobody scores this round.';
    else if (v.caught) text = `${who(v.oddId)} ${isMe(v.oddId) ? 'were' : 'was'} the odd one out, and got caught.`;
    else {
      text = `${who(v.oddId)} ${isMe(v.oddId) ? 'were' : 'was'} the odd one out, and got away with it.`;
      if (v.guess) text += ` ${isMe(v.oddId) ? 'Your' : 'Their'} guess, "${v.guess}", was ${v.guessRight ? 'right' : 'wrong'}.`;
      else text += ' No guess at the word.';
    }
    p.append(text);
    const mine = (v.gains ?? []).find(([id]) => isMe(id));
    if (mine) p.append(' ', el('span', 'gain', `+${mine[1]}`));
  }
  return p;
}

/** Everyone in the round, in clue order, with their clues. In the vote each one is a button. */
function seats(v) {
  const list = el('ol', 'seats');
  const after = v.phase === 'guess' || v.phase === 'reveal';
  for (const id of v.order) {
    const clues = v.clues.filter(([from]) => from === id).map(([, c]) => c ?? 'no clue');
    const canVote = v.phase === 'vote' && v.playing && !isMe(id);
    const seat = el(canVote ? 'button' : 'div', 'seat');
    seat.append(el('span', 'who', nameOf(id) + (isMe(id) ? ' (you)' : '')));
    seat.append(el('span', `clues${clues.length ? '' : ' none'}`, clues.length ? clues.join(', ') : v.phase === 'clue' ? 'No clue yet' : 'No clues'));
    if (v.phase === 'clue' && v.turn === id) seat.classList.add('turn');
    if (canVote) {
      seat.type = 'button';
      seat.disabled = v.mine != null;
      if (v.mine === id) { seat.classList.add('mine'); seat.append(el('span', 'side', 'Your vote')); }
      seat.onclick = () => toHost({ type: 'vote', round: v.round, id });
    }
    if (after) {
      const voters = v.votes.filter(([, to]) => to === id).map(([from]) => (isMe(from) ? 'you' : nameOf(from)));
      if (id === v.oddId) seat.classList.add('odd');
      const side = [];
      if (id === v.oddId) side.push('Odd one out');
      if (voters.length) side.push(`Voted for by ${voters.join(', ')}`);
      if (side.length) seat.append(el('span', 'side', side.join('. ')));
    }
    const li = el('li');
    li.append(seat);
    list.append(li);
  }
  return list;
}

function drawLobby() {
  panel.append(el('h1', '', 'Odd One Out'), playerChips());
  panel.append(el('p', 'how muted', 'Everyone gets the same secret word, except one of you, who gets a close cousin of it. Nobody is told which they have. Take turns giving one-word clues, then vote on who has the other word.'));
  panel.append(el('p', 'how muted small', `Voting for the odd one out scores ${POINTS.caught} if they're caught and ${POINTS.spotted} if they aren't. Getting away with it scores ${POINTS.away}, and ${POINTS.guessed} more for guessing everyone else's word.`));
  const few = Peiskos.players.length < MIN_PLAYERS;
  if (Peiskos.isHost) {
    const opts = el('div', 'opts');
    opts.append(
      ...choice('optRounds', 'Rounds', [[3, '3'], [5, '5'], [8, '8'], [12, '12']], chosen.rounds, (n) => { chosen.rounds = n; }),
      ...choice('optClues', 'Clues each', [[1, '1'], [2, '2'], [3, '3']], chosen.clues, (n) => { chosen.clues = n; }),
    );
    panel.append(opts);
    if (few) panel.append(el('p', 'note muted', `Odd One Out needs ${MIN_PLAYERS} players. Waiting for more to join.`));
  } else {
    panel.append(el('p', 'note muted', few ? `Odd One Out needs ${MIN_PLAYERS} players. Waiting for more to join.` : `Waiting for ${nameOf(Peiskos.hostId)} to start.`));
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
  if (d.type === 'nope') return showToast(String(d.text ?? '').slice(0, 80));
  if (d.type !== 'state') return;
  const before = view;
  const v = view = d.view;
  setClock(v.left, v.total);
  const fresh = before.phase !== v.phase || before.round !== v.round;
  // Screen readers hear each step once, and each clue as it comes.
  if (v.phase === 'clue' && fresh) say(v.playing ? `Round ${v.round + 1}. Your word is ${v.word}. ${isMe(v.turn) ? 'Your turn to give a clue.' : `${nameOf(v.turn)} gives the first clue.`}` : `Round ${v.round + 1}. You're watching this one.`);
  else if (v.phase === 'clue' && v.clues.length > (before.clues?.length ?? 0)) {
    const [from, clue] = v.clues[v.clues.length - 1];
    say(`${who(from)}: ${clue ?? 'no clue'}. ${isMe(v.turn) ? 'Your turn.' : ''}`);
  } else if (v.phase === 'clue' && before.turn !== v.turn && isMe(v.turn)) say('Your turn to give a clue.');
  else if (v.phase === 'vote' && fresh) say('Time to vote. Who has the other word?');
  else if ((v.phase === 'guess' || v.phase === 'reveal') && fresh) say(note(v).textContent);
  render();
}

// ---------- the host's game

let G = null;
let tick = 0;
let deck = [];

const present = (id) => Peiskos.players.some((p) => p.id === id);
const giver = () => G.order[G.turn % G.order.length];
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
  const playing = G.order.includes(id);
  Object.assign(v, {
    round: G.round, rounds: G.rounds, order: G.order, clues: G.clues, playing,
    word: playing ? (id === G.oddId ? G.words.odd : G.words.main) : null,
    left: Math.max(0, G.endsAt - Date.now()), total: G.total,
  });
  if (G.phase === 'clue') v.turn = giver();
  if (G.phase === 'vote') Object.assign(v, { voted: G.votes.size, voters: G.order.filter(present).length, mine: G.votes.get(id) ?? null });
  if (G.phase === 'guess' || G.phase === 'reveal') Object.assign(v, { oddId: G.oddId, votes: [...G.votes] });
  if (G.phase === 'reveal') Object.assign(v, { caught: G.caught, gone: G.gone, words: G.words, guess: G.guess, guessRight: G.guessRight, gains: [...G.gains] });
  return v;
}
function broadcast() {
  for (const p of Peiskos.players) {
    const d = { type: 'state', view: viewFor(p.id) };
    if (p.id === Peiskos.me.id) onView(d); else Peiskos.send(p.id, d);
  }
  Peiskos.snapshot({ scores: [...G.scores] });
}

function hostStart() {
  if (G.phase !== 'lobby' || Peiskos.players.length < MIN_PLAYERS) return;
  G.scores = new Map(Peiskos.players.map((p) => [p.id, 0]));
  G.rounds = chosen.rounds;
  G.cluesEach = chosen.clues;
  G.round = -1;
  Peiskos.busy(true);
  clearInterval(tick);
  tick = setInterval(hostTick, 250);
  nextRound();
}

function nextRound() {
  G.round++;
  if (G.round >= G.rounds) {
    clearInterval(tick);
    G.phase = 'over';
    Peiskos.busy(false);
    return broadcast();
  }
  if (Peiskos.players.length < MIN_PLAYERS) {
    showToast(`Odd One Out needs ${MIN_PLAYERS} players.`);
    return hostLobby();
  }
  if (!deck.length) deck = shuffle(WORD_PAIRS.map((_, i) => i));
  const pair = WORD_PAIRS[deck.pop()];
  const flip = Math.random() < 0.5;
  G.words = { main: pair[flip ? 1 : 0], odd: pair[flip ? 0 : 1] };
  G.order = shuffle(Peiskos.players.map((p) => p.id));
  G.oddId = G.order[Math.floor(Math.random() * G.order.length)];
  G.clues = [];
  G.turn = 0;
  G.votes = new Map();
  G.gains = new Map();
  G.guess = null;
  G.guessRight = false;
  G.caught = false;
  G.gone = false;
  G.phase = 'clue';
  setEnds(CLUE_SECONDS);
  broadcast();
}

/** On to the next person still here, or to the vote once everyone has given their clues. */
function nextTurn() {
  const turns = G.order.length * G.cluesEach;
  do G.turn++; while (G.turn < turns && !present(giver()));
  if (G.turn >= turns) { G.phase = 'vote'; setEnds(VOTE_SECONDS); } else setEnds(CLUE_SECONDS);
  broadcast();
}

function countVotes() {
  const counts = new Map();
  for (const to of G.votes.values()) counts.set(to, (counts.get(to) ?? 0) + 1);
  const most = Math.max(0, ...counts.values());
  // Caught means more votes than anyone else: a tie lets the odd one out slip away.
  G.caught = most > 0 && counts.get(G.oddId) === most && [...counts.values()].filter((n) => n === most).length === 1;
  for (const [from, to] of G.votes) if (to === G.oddId) G.gains.set(from, G.caught ? POINTS.caught : POINTS.spotted);
  if (G.caught || !present(G.oddId)) return finish();
  G.gains.set(G.oddId, POINTS.away);
  G.phase = 'guess';
  setEnds(GUESS_SECONDS);
  broadcast();
}

function finish() {
  for (const [id, pts] of G.gains) G.scores.set(id, (G.scores.get(id) ?? 0) + pts);
  G.phase = 'reveal';
  setEnds(REVEAL_SECONDS);
  broadcast();
}

function hostTick() {
  if (Date.now() < G.endsAt) return;
  if (G.phase === 'clue') { G.clues.push([giver(), null]); nextTurn(); }
  else if (G.phase === 'vote') countVotes();
  else if (G.phase === 'guess') finish();
  else if (G.phase === 'reveal') nextRound();
}

function hostMsg(from, d) {
  if (!G) return;
  if (d.type === 'hello') {
    if (!G.scores.has(from)) G.scores.set(from, 0);
    return Peiskos.send(from, { type: 'state', view: viewFor(from) });
  }
  if (d.round !== G.round) return;
  if (d.type === 'clue' && G.phase === 'clue' && from === giver()) {
    const clue = tidy(d.clue, CLUE_MAX);
    const problem = clueProblem(clue, from === G.oddId ? G.words.odd : G.words.main);
    if (problem) { if (from !== Peiskos.me.id) Peiskos.send(from, { type: 'nope', text: problem }); return; }
    G.clues.push([from, clue]);
    nextTurn();
  } else if (d.type === 'vote' && G.phase === 'vote' && G.order.includes(from) && !G.votes.has(from)) {
    const to = Number(d.id);
    if (to === from || !G.order.includes(to)) return;
    G.votes.set(from, to);
    if (G.order.filter(present).every((id) => G.votes.has(id))) countVotes(); else broadcast();
  } else if (d.type === 'guess' && G.phase === 'guess' && from === G.oddId) {
    const guess = tidy(d.guess, 40);
    if (!plain(guess)) return;
    G.guess = guess;
    G.guessRight = plain(G.guess) === plain(G.words.main);
    if (G.guessRight) G.gains.set(from, POINTS.away + POINTS.guessed);
    finish();
  }
}

Peiskos.on('msg', (from, d) => {
  if (Peiskos.isHost) return hostMsg(from, d);
  if (from === Peiskos.hostId) onView(d);
});

Peiskos.on('players', (players) => {
  if (!Peiskos.isHost) { if (view.phase === 'lobby') render(); return; }
  for (const p of players) if (!G.scores.has(p.id)) G.scores.set(p.id, 0);
  const inRound = G.phase === 'clue' || G.phase === 'vote' || G.phase === 'guess';
  if (inRound && !present(G.oddId)) {
    // No odd one out, no round.
    G.gone = true;
    G.gains = new Map();
    return finish();
  }
  if (G.phase === 'clue' && !present(giver())) return nextTurn();
  if (G.phase === 'vote' && G.votes.size && G.order.filter(present).every((id) => G.votes.has(id))) return countVotes();
  broadcast();
});

Peiskos.on('init', (resume) => {
  if (Peiskos.isHost) {
    hostLobby();
    if (resume && Array.isArray(resume.scores)) { for (const [id, pts] of resume.scores) if (G.scores.has(id)) G.scores.set(id, Number(pts) || 0); broadcast(); }
  } else Peiskos.send(Peiskos.hostId, { type: 'hello' });
  render();
});

// Leaving is in Peiskos's game bar; the host ending the game ends it for everyone.
