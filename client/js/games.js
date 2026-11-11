// Games at the fire: one game per fire, for some of the people sitting there (each game says how many).
//
// A game is its own page (client/games/<name>/), shown in a frame on the fire's stage. Whoever
// starts it is the host: their copy runs the match, and the others' copies send it their moves.
// Peiskos's server passes those messages along to the right players (nothing goes peer to peer),
// keeps who's playing, and ends the game when the host leaves.

const FIRE_GAMES = {
  melonbomber: {
    title: 'Melon Bomber',
    icon: '🍉',
    maxPlayers: 4,
    blurb: 'Drop melons, break crates, grab power-ups and be the last melon standing. Two to four players; bots fill in if you play alone.',
  },
  stockpile: {
    title: 'Stockpile',
    icon: '🃏',
    maxPlayers: 8,
    blurb: 'Build the piles from 1 to 12 and be the first to empty your stockpile. Wilds are anything. Two to eight players.',
  },
  sketchguess: {
    title: 'Sketch & Guess',
    icon: '✏️',
    maxPlayers: 12,
    blurb: 'Take turns drawing a word while everyone else races to guess it. Two to twelve players.',
  },
  trivia: {
    title: 'Fireside Trivia',
    icon: '❓',
    maxPlayers: 12,
    blurb: 'Thousands of questions in two dozen categories, plus your hearth\'s own. Faster right answers score more.',
  },
  sketchpad: {
    title: 'Sketchpad',
    icon: '🎨',
    maxPlayers: 16,
    blurb: 'One big page everyone at the fire draws on together. Save it as a picture when you\'re done.',
  },
};
const gameMax = (name) => FIRE_GAMES[name]?.maxPlayers ?? 4;
// What a game's page may ask Peiskos's server for, on its player's behalf (games can't reach the network themselves).
const GAME_API = [/^\/api\/trivia\/(categories\?serverId=\d+|round)$/, /^\/api\/servers\/\d+\/(trivia(\/\d+)?|game-words)$/];

let fireGame = null; // { channelId, game: { name, hostId, players, since } } at your fire
let gamePlay = null; // { name, frame, queue, snapshot, busy } while you're playing, on this device
// Where this device is with the fire's game: see PHASES.fireGame in phases.js.
const gamePhase = phaseMachine('fireGame', 'none', { el: () => $('#game-panel') });
let gameAsk = null; // the latest ask, so an older one's timeout leaves a newer one alone

const sendGame = (msg) => state.ws?.readyState === WebSocket.OPEN && state.ws.send(JSON.stringify({ type: 'game', ...msg }));

/** Asks to start (or join) a game. It opens once Peiskos says you're in; turned down, or no answer, and the ask is over. */
function askForGame(name) {
  if (state.ws?.readyState !== WebSocket.OPEN) return toast("You're not connected right now, so the game can't start. Try again once you're back.");
  const ask = {};
  gameAsk = ask;
  const over = () => {
    if (gameAsk !== ask) return;
    gameAsk = null;
    if (gamePhase.to('none')) renderGamePanel();
  };
  const nonce = Math.random().toString(36).slice(2);
  unconfirmed.set(nonce, (err) => { over(); toast(err.message); });
  setTimeout(() => { unconfirmed.delete(nonce); if (gamePhase.is('asking')) over(); }, 15000);
  gamePhase.to('asking');
  sendGame({ action: 'start', game: name, nonce }); // joins, or moves your game to this device
  renderGamePanel();
}
const inFireGame = () => !!fireGame?.game?.players.includes(state.me?.id);
const gamePlayers = (g) => g.players.map((id) => ({ id, name: nameOf(id, 'Player') }));

// The casino's games (casino.js) sit in their own part of the picker: play chips, not a match.
const CASINO_GAMES = {
  poker: { title: "Texas hold 'em", icon: '♠️', blurb: "The fire's own table: up to eight players, blinds 10/20." },
  blackjack: { title: 'Blackjack', icon: '🂡', blurb: 'You against the dealer. Blackjack pays 3 to 2.' },
  slots: { title: 'Slots', icon: '🎰', blurb: 'Five reels, ten lines. Three flames pays 500 times.' },
  cases: { title: 'Cases', icon: '🎁', blurb: 'Open cases for made-up weapon skins, then keep them or sell them back.' },
  battles: { title: 'Case battles', icon: '⚔️', blurb: 'Up to four of you open the same cases. Highest total takes every skin.' },
};

function openGamePicker() {
  const g = fireGame?.game;
  const playing = g && inFireGame();
  const running = g && `
      <button type="button" class="game-pick" data-join>
        <span class="game-pick-icon" aria-hidden="true">${FIRE_GAMES[g.name]?.icon ?? '🎲'}</span>
        <span class="game-pick-text"><b>${FIRE_GAMES[g.name]?.title ?? 'A game'}</b><span class="small muted">Started by ${g.hostId === state.me.id ? 'you' : escapeHtml(nameOf(g.hostId))} · ${g.players.length} of ${gameMax(g.name)} playing</span></span>
        <span class="btn">${playing ? 'Open' : 'Join'}</span>
      </button>`;
  modal(`<h2>Play a game together</h2>
    <div class="game-picks">${running || Object.entries(FIRE_GAMES).map(([name, f]) => `
      <button type="button" class="game-pick" data-game="${name}">
        <span class="game-pick-icon" aria-hidden="true">${f.icon}</span>
        <span class="game-pick-text"><b>${f.title}</b><span class="small muted">${f.blurb}</span></span>
        <span class="btn">Start</span>
      </button>`).join('')}
    </div>
    <h3 class="game-picks-head">On your own</h3>
    <div class="game-picks">
      <button type="button" class="game-pick" data-fishing>
        <span class="game-pick-icon" aria-hidden="true">🎣</span>
        <span class="game-pick-text"><b>Fireside Angler</b><span class="small muted">Fish five waters for 115 species, find hats in treasure chests, and leave idle rods out while you're away.</span></span>
        <span class="btn">Fish</span>
      </button>
    </div>
    <h3 class="game-picks-head">Casino</h3>
    <p class="small muted">Play chips only. Everyone gets 10,000 to start, and more for free every day.</p>
    <div class="game-picks casino-picks">${Object.entries(CASINO_GAMES).map(([tab, c]) => `
      <button type="button" class="game-pick" data-casino="${tab}">
        <span class="game-pick-icon" aria-hidden="true">${c.icon}</span>
        <span class="game-pick-text"><b>${c.title}</b><span class="small muted">${c.blurb}</span></span>
      </button>`).join('')}
    </div>`);
  const card = $('#modal-card');
  card.querySelectorAll('[data-game]').forEach((b) => (b.onclick = () => {
    closeModal();
    askForGame(b.dataset.game);
  }));
  card.querySelector('[data-join]')?.addEventListener('click', () => { closeModal(); joinFireGame(); });
  card.querySelector('[data-fishing]').onclick = () => { closeModal(); openFishing(); };
  card.querySelectorAll('[data-casino]').forEach((b) => (b.onclick = () => {
    closeModal();
    openCasino(b.dataset.casino);
  }));
}

/** A game started on a newer Peiskos than this app: its page isn't in here yet. */
function missingGame(name) {
  if (FIRE_GAMES[name]) return false;
  toast(isApp ? 'This game is newer than your Peiskos app. Update the app to play it.' : 'This game is newer than this page. Reload Peiskos to play it.');
  return true;
}

function joinFireGame() {
  const g = fireGame?.game;
  if (!g || missingGame(g.name)) return;
  if (gamePlay) return showGame();
  if (!inFireGame() && g.players.length >= gameMax(g.name)) return toast(`The game is full (${gameMax(g.name)} players).`);
  if (gamePhase.is('asking')) return;
  askForGame(g.name);
}

function onGameState(ev) {
  if (state.voice?.channelId !== ev.channelId) return;
  const before = fireGame?.game;
  fireGame = { channelId: ev.channelId, game: ev.game };
  const g = ev.game;
  if (!g) {
    if (gamePlay) toast(before && before.hostId !== state.me.id ? `${nameOf(before.hostId)} ended the game.` : 'The game ended.');
    closeGame();
  } else if (!before || before.since !== g.since) {
    if (g.hostId !== state.me.id) fireNote(`${nameOf(g.hostId)} started ${FIRE_GAMES[g.name]?.title ?? 'a game'}`);
  }
  if (g && inFireGame()) {
    if (gamePlay) postToGame({ kind: 'players', hostId: g.hostId, players: gamePlayers(g) });
    else if (gamePhase.is('asking')) loadGame(g.name);
  } else if (gamePlay) closeGame(); // out of it (or playing on another device now)
  renderGamePanel();
}

function onGameMessage(ev) {
  if (!gamePlay || state.voice?.channelId !== ev.channelId) return;
  postToGame({ kind: 'msg', from: ev.from, data: ev.data });
}

/** Messages wait until the game's page says it's ready for them. */
function postToGame(msg) {
  if (!gamePlay) return;
  if (!gamePhase.is('playing')) return gamePlay.queue.push(msg);
  gamePlay.frame.contentWindow?.postMessage(msg, '*');
}

function loadGame(name) {
  closeGame();
  const frame = document.createElement('iframe');
  frame.className = 'game-iframe';
  frame.title = FIRE_GAMES[name]?.title ?? 'Game';
  frame.src = `games/${name}/index.html`;
  frame.allow = 'fullscreen';
  gamePlay = { name, frame, queue: [], snapshot: null, busy: false };
  gameAsk = null;
  gamePhase.to('loading');
  $('#game-frame').replaceChildren(frame);
  $('#game-view-title').textContent = frame.title;
  showGame();
}

function showGame() {
  if (!gamePlay) return;
  if (gamePop?.kind === 'game') return focusGamePop();
  if (!state.stageOpen) openStage();
  state.stageShow = 'game';
  renderStage();
  renderGamePanel();
  gamePlay.frame.focus();
}

function closeGame() {
  gamePlay = null;
  gameAsk = null;
  gamePhase.to('none');
  $('#game-frame').replaceChildren();
  closeGamePop('game');
  renderVoicePlaces();
  if (state.stageShow === 'game') {
    state.stageShow = 'fire';
    renderStage();
  }
}

/** Leaving the fire leaves the game (Peiskos's server does that part). */
function stopGame() {
  fireGame = null;
  closeGame();
  renderGamePanel();
}

/** Peiskos's server lets go of your game when your connection drops; it says what's going on again once you're back. */
function gameConnectionLost() {
  if (gamePlay) toast('Your connection dropped, so you left the game.');
  stopGame();
}

function leaveFireGame() {
  sendGame({ action: 'leave' });
  closeGame();
  renderGamePanel();
}

window.addEventListener('message', (e) => {
  if (!gamePlay || e.source !== gamePlay.frame.contentWindow) return;
  const m = e.data;
  if (!m || typeof m !== 'object') return;
  if (m.kind === 'ready') {
    const g = fireGame?.game;
    if (!g) return;
    gamePhase.to('playing');
    // The page loads again when it moves between windows (popping out); the host's game picks up
    // where it left off from the last snapshot it gave.
    const hearthId = roomById(fireGame.channelId)?.s.id ?? null;
    gamePlay.frame.contentWindow.postMessage({ kind: 'init', me: { id: state.me.id, name: nameOf(state.me.id, 'Player') }, hostId: g.hostId, players: gamePlayers(g), resume: gamePlay.snapshot, serverId: hearthId }, '*');
    for (const q of gamePlay.queue.splice(0)) postToGame(q);
  } else if (m.kind === 'send') {
    if (m.to === 'all' || Number.isInteger(m.to)) sendGame({ action: 'send', to: m.to, data: m.data });
  } else if (m.kind === 'leave') {
    leaveFireGame();
  } else if (m.kind === 'snapshot') {
    gamePlay.snapshot = m.data && typeof m.data === 'object' ? m.data : null;
  } else if (m.kind === 'api') {
    // A question for the server (Fireside Trivia's questions, a hearth's own words): the answer goes back to the page.
    const frame = gamePlay.frame;
    const reply = (out) => frame.contentWindow?.postMessage({ kind: 'api-result', id: m.id, ...out }, '*');
    const path = String(m.path ?? '');
    const method = ['GET', 'POST', 'PUT', 'DELETE'].includes(m.method) ? m.method : 'GET';
    if (!GAME_API.some((re) => re.test(path))) return reply({ error: "Games can't ask for that" });
    api(path, { method, body: m.body && typeof m.body === 'object' ? m.body : undefined })
      .then((data) => reply({ data }), (err) => reply({ error: err.message }));
  } else if (m.kind === 'save') {
    // A game's picture (Sketchpad): its frame can't download or open the share sheet on every phone.
    if (!(m.blob instanceof Blob) || m.blob.size > 20e6) return;
    const name = String(m.name ?? 'picture.png').replace(/[^\w. -]+/g, '').slice(0, 80) || 'picture.png';
    saveOrShare(new Blob([m.blob], { type: 'image/png' }), name).catch((err) => { if (err?.name !== 'AbortError') toast("Couldn't save the picture."); });
  } else if (m.kind === 'busy') {
    // A round that can't move between windows is going.
    gamePlay.busy = !!m.on;
    renderGamePopButtons();
  }
});

function renderGamePanel() {
  const g = fireGame?.game;
  $('#fire-game').classList.toggle('on', !!g);
  $('#game-panel').classList.toggle('hidden', !g);
  if (!g) return;
  const info = FIRE_GAMES[g.name] ?? { title: 'A game', icon: '🎲' };
  const max = gameMax(g.name);
  const playing = inFireGame();
  $('#game-panel-icon').textContent = info.icon;
  $('#game-panel-title').textContent = info.title;
  $('#game-panel-sub').textContent = `Started by ${g.hostId === state.me.id ? 'you' : nameOf(g.hostId)} · ${g.players.length} of ${max} playing`;
  const open = $('#game-panel-open');
  const asking = gamePhase.is('asking');
  open.textContent = asking ? 'Joining…' : playing ? (gamePlay ? 'Back to the game' : 'Open the game') : g.players.length >= max ? 'Full' : 'Join';
  open.disabled = asking || (!playing && g.players.length >= max);
  const leave = $('#game-panel-leave');
  leave.classList.toggle('hidden', !playing);
  leave.textContent = g.hostId === state.me.id ? 'End game' : 'Leave';
  leave.title = g.hostId === state.me.id ? 'Ends the game for everyone' : '';
}

$('#fire-game').innerHTML = GAME_ICON;
$('#fire-game').onclick = openGamePicker;
$('#game-panel-open').onclick = joinFireGame;
$('#game-panel-leave').onclick = leaveFireGame;
$('#game-view-back').onclick = () => {
  state.stageShow = 'fire';
  renderStage();
  renderGamePanel();
};
