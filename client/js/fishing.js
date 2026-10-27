// Fireside Angler (client/games/fishing): the idle fishing game, opened from the games at the fire.
//
// The game is its own page, framed on the fire's stage like the other games, but it's just you. It
// runs everything itself; this side keeps its save on the server (one per person per hearth, like
// casino chips) and posts its big catches in the fireside chat. The frame stays open while you're at
// the fire, so going back to the fire and returning keeps the line in the water.

const fishing = { play: null }; // { frame, hearthId, rev, saving, pending } for the open game
const fishingClosing = new Set(); // games just closed, still handing over their last save
const fishingApi = (hearthId) => `/api/servers/${hearthId}/fishing`;

function openFishing() {
  if (!state.voice) return;
  const hearthId = roomById(state.voice.channelId)?.s.id ?? null;
  if (hearthId === null) return;
  // Each hearth has its own save, so a fire in another hearth opens another game.
  if (fishing.play && fishing.play.hearthId !== hearthId) stopFishing();
  if (!fishing.play) {
    const frame = document.createElement('iframe');
    frame.className = 'game-iframe fishing-iframe';
    frame.title = 'Fireside Angler';
    frame.src = 'games/fishing/index.html';
    fishing.play = { frame, hearthId, rev: 0, saving: false, pending: null };
    $('#fishing-frame').replaceChildren(frame);
  }
  if (!state.stageOpen) openStage();
  state.stageShow = 'fishing';
  renderStage();
  fishing.play.frame.focus();
}

function closeFishing() {
  if (state.stageShow === 'fishing') {
    state.stageShow = 'fire';
    renderStage();
  }
}

/** Leaving the fire closes the game, after it hands over anything it hasn't saved yet. */
function stopFishing() {
  closeFishing();
  const play = fishing.play;
  if (!play) return;
  fishing.play = null;
  renderVoicePlaces();
  fishingClosing.add(play);
  // Off the dock for everyone else at the fire.
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'fishing', status: null }));
  play.frame.contentWindow?.postMessage({ kind: 'flush' }, '*');
  setTimeout(() => { play.frame.remove(); fishingClosing.delete(play); }, 400);
}

/** One save at a time; whatever comes in meanwhile waits, and only the newest is sent. */
async function saveFishing(play, data) {
  if (play.saving) { play.pending = data; return; }
  play.saving = true;
  try {
    const r = await api(fishingApi(play.hearthId), { method: 'POST', body: { save: data, rev: play.rev } });
    play.rev = r.rev;
    if (r.conflict) {
      // Another device saved since this one loaded: carry on from its save instead.
      play.pending = null;
      play.frame.contentWindow?.postMessage({ kind: 'reload', save: r.save }, '*');
    }
  } catch (err) {
    // Offline or throttled: the game saves again on its next change, so nothing is lost for long.
    console.warn('Fireside Angler did not save:', err.message);
  } finally {
    play.saving = false;
    if (play.pending) {
      const next = play.pending;
      play.pending = null;
      saveFishing(play, next);
    }
  }
}

window.addEventListener('message', async (e) => {
  const play = [fishing.play, ...fishingClosing].find((p) => p && e.source === p.frame.contentWindow);
  if (!play) return;
  const m = e.data;
  if (!m || typeof m !== 'object') return;
  if (m.kind === 'ready') {
    try {
      const r = await api(fishingApi(play.hearthId));
      play.rev = r.rev;
      play.frame.contentWindow?.postMessage({ kind: 'init', save: r.save, theme: currentTheme() }, '*');
    } catch (err) {
      toast(`Couldn't open your tackle box: ${err.message}`);
      if (play === fishing.play) stopFishing();
    }
  } else if (m.kind === 'save' && m.data && typeof m.data === 'object') {
    saveFishing(play, m.data);
  } else if (m.kind === 'status' && m.status && typeof m.status === 'object' && play === fishing.play) {
    // What your angler is doing, so the others fishing at this fire see you on the dock.
    if (state.voice && state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'fishing', status: m.status }));
  } else if (m.kind === 'catch' && m.c && typeof m.c === 'object') {
    // A new best of the day for you, for the hearth's leaderboard.
    api(`${fishingApi(play.hearthId)}/catch`, { method: 'POST', body: m.c }).catch((err) => console.warn('Fireside Angler catch not sent:', err.message));
  } else if (m.kind === 'board') {
    let board;
    try {
      const r = await api(`${fishingApi(play.hearthId)}/board`);
      board = { rows: r.rows.map((row) => ({ ...row, me: row.userId === state.me?.id })) };
    } catch (err) {
      board = { error: err.message };
    }
    play.frame.contentWindow?.postMessage({ kind: 'board', board }, '*');
  } else if (m.kind === 'brag' && typeof m.text === 'string' && play === fishing.play) {
    // Said as you, in the fireside chat at the fire you're at.
    if (state.voice && state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'fireside_send', content: m.text.slice(0, 1000) }));
  }
});

/** Someone else at your fire is fishing (or stopped): their angler on your dock. */
function onFishingDock(ev) {
  const play = fishing.play;
  if (!play || ev.channelId !== state.voice?.channelId) return;
  play.frame.contentWindow?.postMessage({ kind: 'dock', userId: ev.userId, name: nameOf(ev.userId, 'Someone'), status: ev.status }, '*');
}

// The game follows Peiskos's light and dark.
new MutationObserver(() => fishing.play?.frame.contentWindow?.postMessage({ kind: 'theme', theme: currentTheme() }, '*'))
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

$('#fishing-back').onclick = closeFishing;
