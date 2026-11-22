// ---------------------------------------------------------------- fire tapes
//
// A fire is taped only once everyone at it says yes. Voice is end-to-end encrypted, so the server
// can't hear the call: instead your own app records your own microphone, only while you're on the
// tape, and sends it a few seconds at a time. "Clip that" keeps the last 30 seconds.

const TAPE_ICON = '<svg viewBox="0 0 24 24"><path d="M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm4.5 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm9 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM7.5 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm9 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM10 14h4v1h-4v-1Z"/></svg>';
const TAPE_CHUNK_MS = 3000; // how often your app sends what it recorded

let tapeNow = null; // { channelId, tape, offset } from the server; offset turns its clock into ours
let tapeRec = null; // your own recording: { tapeId, part, rec, track, seq, started, queue, stopped }
let tapeTick = 0;

const tapeOnIt = () => !!tapeNow?.tape && tapeNow.tape.phase === 'taping' && tapeNow.tape.yes.includes(state.me.id);
const tapeHearth = () => { const s = fireServer(); return !!s && !isDm(s); };
const tapeClock = (ms) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  return h ? `${h}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}` : clock(sec);
};
const sendTape = (msg) => state.ws?.readyState === WebSocket.OPEN && state.ws.send(JSON.stringify({ type: 'tape', ...msg }));

function onTapeState(ev) {
  if (state.voice?.channelId !== ev.channelId) {
    if (!ev.tape && tapeNow?.channelId === ev.channelId) tapeNow = null;
    renderTape();
    return syncTapeRecording();
  }
  tapeNow = ev.tape ? { channelId: ev.channelId, tape: ev.tape, offset: Date.now() - ev.tape.now } : null;
  renderTape();
  syncTapeRecording();
  renderFire();
}

function onTapeNote(ev) {
  if (state.voice?.channelId === ev.channelId) fireNote(ev.text);
}

function onTapeClip(ev) {
  refreshTapes(ev.channelId);
  if (ev.clip.by !== state.me.id) return;
  if (ev.clip.state === 'ready') toast('Clip saved.', { action: 'Listen', onAction: () => openTapes(ev.channelId) });
  else if (ev.clip.state === 'empty') toast('Nothing was said in the last 30 seconds, so the clip is empty.');
  else notice("The clip couldn't be cut.");
}

function onTapeReady(ev) {
  refreshTapes(ev.channelId);
  if (ev.state === 'failed') return notice(`The tape from ${ev.fire} couldn't be put together.`);
  if (ev.state === 'empty') return toast(`Nothing was taped at ${ev.fire}.`);
  toast(`The tape from ${ev.fire} is ready.`, { action: 'Listen', onAction: () => openTapes(ev.channelId), timeout: 8000 });
}

// ---- the panel above the fire's buttons: asking, and taping

function renderTape() {
  const panel = $('#tape-panel');
  const fireBtn = $('#fire-tape');
  $('#fire-tape-wrap').classList.toggle('hidden', !state.tapesEnabled || !tapeHearth());
  const t = state.voice && tapeNow?.channelId === state.voice.channelId ? tapeNow.tape : null;
  fireBtn.classList.toggle('on', !!t);
  fireBtn.title = t?.phase === 'taping' ? 'This fire is being taped' : 'Tape this fire';
  panel.classList.toggle('hidden', !t);
  clearInterval(tapeTick);
  if (!t) return panel.replaceChildren();
  const by = t.by === state.me.id ? 'You' : nameOf(t.by);
  const here = fireHere();
  const left = () => Math.max(0, Math.ceil((t.endsAt - (Date.now() - tapeNow.offset)) / 1000));
  if (t.phase === 'asking') {
    const mine = t.by === state.me.id;
    const answered = t.yes.includes(state.me.id);
    panel.dataset.phase = 'asking';
    panel.innerHTML = `
      <span class="tape-reel" aria-hidden="true">${TAPE_ICON}</span>
      <div class="tape-info">
        <b>${mine ? 'Asking everyone to tape this fire' : `${escapeHtml(by)} wants to tape this fire`}</b>
        <span class="small muted">${t.keep === 'clips' ? 'Only clips will be kept. ' : ''}Anyone who can see this fire can listen later. Your app records only your own voice.</span>
        <span class="small muted tape-count"></span>
      </div>
      <div class="tape-actions">
        ${mine ? '<button class="link-btn danger-link" id="tape-cancel">Call it off</button>'
          : answered ? '<span class="small muted">You said yes</span>'
          : '<button class="btn" id="tape-yes">Tape me</button><button class="btn secondary" id="tape-no">Not me</button>'}
      </div>`;
    const count = () => (panel.querySelector('.tape-count').textContent = `${t.yes.filter((id) => here.includes(id)).length} of ${here.length} said yes · ${left()}s left`);
    count();
    tapeTick = setInterval(count, 1000);
    panel.querySelector('#tape-cancel')?.addEventListener('click', () => sendTape({ action: 'cancel' }));
    panel.querySelector('#tape-yes')?.addEventListener('click', () => sendTape({ action: 'answer', yes: true }));
    panel.querySelector('#tape-no')?.addEventListener('click', () => sendTape({ action: 'answer', yes: false }));
    // Asked: the panel says so for screen readers, and the answer is a keypress away.
    panel.querySelector('#tape-yes')?.focus({ preventScroll: true });
    return;
  }
  // Taping. Someone who arrived since is asked first; until they say yes, nothing of theirs is taped.
  const on = t.yes.includes(state.me.id);
  const said = t.no.includes(state.me.id);
  panel.dataset.phase = on ? 'taping' : 'asked';
  const names = t.yes.filter((id) => here.includes(id)).map((id) => (id === state.me.id ? 'you' : nameOf(id)));
  panel.innerHTML = `
    <span class="tape-dot" aria-hidden="true"></span>
    <div class="tape-info">
      <b>Taping <span class="tape-time"></span></b>
      <span class="small muted tape-who"></span>
      ${!on && !said ? '<span class="small">This fire is being taped. Anyone who can see it can listen later. Your app records only your own voice.</span>' : ''}
    </div>
    <div class="tape-actions">
      ${on ? `<button class="btn" id="tape-clip" title="Keep the last 30 seconds">Clip that</button>
        <button class="link-btn danger-link" id="tape-stop">Stop</button>
        <button class="link-btn" id="tape-leave" title="Take your voice off the tape, including what was taped already">Take me off</button>`
        : said ? '<button class="link-btn" id="tape-yes">Tape me after all</button>'
        : '<button class="btn" id="tape-yes">Tape me</button><button class="btn secondary" id="tape-no">Not me</button>'}
    </div>`;
  panel.querySelector('.tape-who').textContent = `${t.keep === 'clips' ? 'Keeping only clips' : 'Keeping everything'} · on it: ${names.join(', ') || 'nobody here'}${t.clips ? ` · ${t.clips} ${t.clips === 1 ? 'clip' : 'clips'}` : ''}`;
  const time = () => (panel.querySelector('.tape-time').textContent = tapeClock(Date.now() - tapeNow.offset - t.startedAt));
  time();
  tapeTick = setInterval(time, 1000);
  panel.querySelector('#tape-clip')?.addEventListener('click', () => sendTape({ action: 'clip' }));
  panel.querySelector('#tape-stop')?.addEventListener('click', () => sendTape({ action: 'stop' }));
  panel.querySelector('#tape-leave')?.addEventListener('click', async () => {
    if (await confirmTapeLeave()) sendTape({ action: 'leave' });
  });
  panel.querySelector('#tape-yes')?.addEventListener('click', () => sendTape({ action: 'answer', yes: true }));
  panel.querySelector('#tape-no')?.addEventListener('click', () => sendTape({ action: 'answer', yes: false }));
}

/** Who's at your fire now, you included. */
function fireHere() {
  const c = roomById(state.voice?.channelId)?.c;
  const ids = [...(c?.voiceUsers ?? [])];
  if (state.voice && !ids.includes(state.me.id)) ids.push(state.me.id);
  return ids;
}

function confirmTapeLeave() {
  return ask({ title: 'Take yourself off the tape?', text: 'What was taped of your voice is deleted, and the clips are cut again without you.', ok: 'Take me off', danger: true });
}

/** Marks the seats of people on the tape. */
function tapeSeatMark(wrap, id) {
  wrap.querySelector('.seat-rec')?.remove();
  if (tapeNow?.tape?.phase === 'taping' && tapeNow.channelId === state.voice?.channelId && tapeNow.tape.yes.includes(id))
    wrap.insertAdjacentHTML('beforeend', '<span class="seat-rec" title="On the tape"><span class="sr-only">On the tape</span></span>');
}

// ---- starting a tape

function openTapeStart() {
  if (tapeNow?.tape && tapeNow.channelId === state.voice?.channelId) return $('#tape-panel').scrollIntoView({ block: 'nearest' });
  const ch = roomById(state.voice?.channelId)?.c;
  modal(`<h2>Tape this fire</h2>
    <p class="small muted">Everyone at the fire is asked first, and it starts once they all say yes. Each person's app records only their own voice. Anyone who can see this fire can listen later.</p>
    <form id="tape-start" class="tape-start">
      <fieldset class="tape-keep">
        <legend class="small">What to keep</legend>
        <label class="tape-choice"><input type="radio" name="keep" value="all" checked /><span><b>Everything</b><span class="small muted">The whole fire, plus any clips. Whole tapes are cleared after ${state.tapeKeepDays || 30} days.</span></span></label>
        <label class="tape-choice"><input type="radio" name="keep" value="clips" /><span><b>Only clips</b><span class="small muted">Press "Clip that" to keep the last 30 seconds. Everything else is thrown away when the tape stops.</span></span></label>
      </fieldset>
      <div class="modal-row">
        <button type="button" class="link-btn" id="tape-past">Past tapes</button>
        <button type="submit" class="btn">Ask everyone</button>
      </div>
    </form>`);
  $('#tape-past').onclick = () => openTapes(ch?.id);
  $('#tape-start').onsubmit = (e) => {
    e.preventDefault();
    sendTape({ action: 'ask', keep: new FormData(e.target).get('keep') });
    closeModal();
  };
}

// ---- recording your own voice while you're on the tape

function tapeMicTrack() {
  const LK = window.LivekitClient;
  const pub = LK && state.voice?.room?.localParticipant?.getTrackPublication(LK.Track.Source.Microphone);
  const track = pub?.track?.mediaStreamTrack;
  return track && track.readyState === 'live' ? track : null;
}
const tapeType = () => (typeof MediaRecorder === 'undefined' ? '' : ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '');

/** Records while you're on a running tape (and only then), and stops the moment you aren't. */
function syncTapeRecording() {
  const want = tapeOnIt() && tapeNow.channelId === state.voice?.channelId ? tapeNow.tape.id : null;
  if (tapeRec && (tapeRec.tapeId !== want || tapeRec.track !== tapeMicTrack())) stopTapeRecording();
  if (!want || tapeRec) return;
  const track = tapeMicTrack();
  const type = tapeType();
  // No microphone yet (still connecting): looked at again in a moment.
  if (!track || !type) return;
  const rec = new MediaRecorder(new MediaStream([track]), { mimeType: type, audioBitsPerSecond: 32000 });
  const r = { tapeId: want, part: Math.random().toString(36).slice(2, 12), rec, track, seq: 0, started: performance.now(), queue: Promise.resolve(), stopped: false };
  rec.ondataavailable = (e) => {
    if (!e.data.size) return;
    const seq = r.seq++;
    const elapsed = Math.round(performance.now() - r.started);
    r.queue = r.queue.then(() => sendTapePiece(r, seq, elapsed, e.data, type));
  };
  rec.onerror = () => stopTapeRecording();
  rec.start(TAPE_CHUNK_MS);
  tapeRec = r;
}

function stopTapeRecording() {
  const r = tapeRec;
  tapeRec = null;
  if (!r) return;
  r.stopped = true;
  // The last few seconds are still sent: the server waits for them.
  try { if (r.rec.state !== 'inactive') r.rec.stop(); } catch {}
}

async function sendTapePiece(r, seq, elapsed, blob, type) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${state.serverUrl}/api/tapes/${r.tapeId}/audio?part=${r.part}&seq=${seq}&elapsed=${elapsed}`, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + state.token, 'content-type': type.split(';')[0] },
        body: blob,
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return;
      // Not on a running tape any more, or the server restarted: a new part starts if it should.
      if (res.status === 403 || res.status === 409 || res.status === 429) {
        if (tapeRec === r && res.status !== 403) stopTapeRecording();
        return;
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 1000 * (attempt + 1)));
  }
}

// The microphone changes (another device picked, a reconnect): a new part starts on the new one.
setInterval(() => { if (tapeNow || tapeRec) syncTapeRecording(); }, 2000);

// ---- listening back

let tapesShown = null; // the fire whose tapes list is open

/** The open tapes list shows a tape or clip that just finished, unless something in it is playing. */
function refreshTapes(channelId) {
  const list = $('#tape-list');
  if (!list || tapesShown !== channelId || [...list.querySelectorAll('audio')].some((a) => !a.paused)) return;
  openTapes(channelId);
}

async function openTapes(channelId) {
  const c = roomById(channelId)?.c;
  tapesShown = channelId;
  let data;
  try { data = await api(`/api/channels/${channelId}/tapes`); } catch (err) { return alertError(err); }
  modal(`<h2>Tapes from ${escapeHtml(c?.name ?? 'this fire')}</h2>
    <p class="small muted">Whole tapes are cleared after ${state.tapeKeepDays || 30} days. Clips stay until someone deletes them.${data.transcripts ? ' Transcripts are made overnight.' : ''}</p>
    <ul class="tape-list" id="tape-list"></ul>`, 'tapes-modal');
  const list = $('#tape-list');
  if (!data.tapes.length) list.innerHTML = '<li class="small muted">No tapes yet. Start one from the Tape button at the fire.</li>';
  for (const t of data.tapes) list.append(tapeItem(t, data.transcripts, channelId));
}

const TAPE_STATE_TEXT = {
  taping: 'Being taped now.',
  mixing: 'Being put together. It takes a moment.',
  empty: 'Nothing was taped.',
  failed: "This tape couldn't be put together.",
};

function tapeItem(t, transcripts, channelId) {
  const li = document.createElement('li');
  li.className = 'tape-item';
  const when = new Date(t.startedAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const length = t.durationMs ? tapeClock(t.durationMs) : '';
  li.innerHTML = `
    <div class="tape-item-head">
      <b>${escapeHtml(when)}</b>
      <span class="small muted">${[length, t.keep === 'clips' ? 'only clips' : '', t.people.map((p) => p.name).join(', ')].filter(Boolean).map(escapeHtml).join(' · ')}</span>
    </div>
    <div class="tape-whole"></div>
    <ul class="tape-clips"></ul>
    <div class="tape-item-actions"></div>
    <div class="tape-transcript hidden" aria-live="polite"></div>`;
  const whole = li.querySelector('.tape-whole');
  if (t.url) whole.append(tapeAudio(t.url, `The whole tape from ${when}`));
  else if (t.cleared) whole.innerHTML = '<span class="small muted">The whole tape was cleared. Its clips are kept.</span>';
  else if (t.keep !== 'clips' || TAPE_STATE_TEXT[t.state]) whole.innerHTML = `<span class="small muted">${escapeHtml(TAPE_STATE_TEXT[t.state] ?? '')}</span>`;
  const clipsEl = li.querySelector('.tape-clips');
  for (const c of t.clips) {
    const row = document.createElement('li');
    row.className = 'tape-clip';
    row.innerHTML = `<span class="small"><b></b> <span class="muted"></span></span>`;
    row.querySelector('b').textContent = `Clip at ${tapeClock(c.endMs)}`;
    row.querySelector('.muted').textContent = `by ${c.by === state.me.id ? 'you' : c.byName}`;
    if (c.url) row.append(tapeAudio(c.url, `Clip at ${tapeClock(c.endMs)}`));
    else row.insertAdjacentHTML('beforeend', `<span class="small muted">${c.state === 'cutting' ? 'Being cut.' : c.state === 'empty' ? 'Nothing was said.' : "Couldn't be cut."}</span>`);
    const tools = document.createElement('span');
    tools.className = 'tape-clip-tools';
    if (transcripts && c.url) tools.append(linkButton('Words', () => showTranscript(row, `/api/tape-clips/${c.id}`, row.querySelector('audio'))));
    if (c.by === state.me.id || t.canDelete) tools.append(linkButton('Delete', async () => {
      try { await api(`/api/tape-clips/${c.id}`, { method: 'DELETE' }); row.remove(); } catch (err) { alertError(err); }
    }, true));
    row.append(tools);
    clipsEl.append(row);
  }
  const actions = li.querySelector('.tape-item-actions');
  if (transcripts && t.keep === 'all' && t.url) actions.append(linkButton('Transcript', () => showTranscript(li, `/api/tapes/${t.id}`, whole.querySelector('audio'))));
  if (t.onIt && t.state !== 'taping') actions.append(linkButton('Take me off', async () => {
    if (!(await confirmTapeLeave())) return;
    try { await api(`/api/tapes/${t.id}/leave`, { method: 'POST', body: {} }); openTapes(channelId); } catch (err) { alertError(err); }
  }));
  if (t.canDelete && t.state !== 'taping') actions.append(linkButton('Delete tape', async () => {
    if (!(await ask({ title: 'Delete this tape?', text: 'The whole tape and all its clips are deleted for everyone.', ok: 'Delete', danger: true }))) return;
    try { await api(`/api/tapes/${t.id}`, { method: 'DELETE' }); li.remove(); } catch (err) { alertError(err); }
  }, true));
  return li;
}

function tapeAudio(url, label) {
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'none';
  audio.src = state.serverUrl + url;
  audio.setAttribute('aria-label', label);
  return audio;
}

function linkButton(text, run, danger = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'link-btn' + (danger ? ' danger-link' : '');
  b.textContent = text;
  b.onclick = run;
  return b;
}

/** Who said what, with each line a button that plays from there. */
async function showTranscript(host, path, audio) {
  const box = host.querySelector(':scope > .tape-transcript') ?? host.appendChild(Object.assign(document.createElement('div'), { className: 'tape-transcript' }));
  if (!box.classList.contains('hidden') && box.childElementCount) return box.classList.add('hidden');
  box.classList.remove('hidden');
  box.textContent = 'Loading…';
  let data;
  try { data = await api(path); } catch (err) { box.textContent = err.message; return; }
  const { state: st, lines } = data.transcript;
  if (!lines.length) {
    box.textContent = st === 'waiting' ? 'The words are written out overnight.' : st === 'cleared' ? 'The whole tape was cleared, so its words were too.' : 'No words were picked up.';
    return;
  }
  box.replaceChildren(...lines.map((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tape-line';
    b.innerHTML = '<span class="tape-at"></span><b></b><span></span>';
    b.children[0].textContent = tapeClock(l.at);
    b.children[1].textContent = l.userId === state.me.id ? 'You' : l.name;
    b.children[2].textContent = l.text;
    b.title = 'Play from here';
    b.onclick = () => { if (audio) { audio.currentTime = l.at / 1000; audio.play().catch(() => {}); } };
    return b;
  }));
  if (st === 'waiting') box.insertAdjacentHTML('beforeend', '<span class="small muted">More words come overnight.</span>');
}

$('#fire-tape').innerHTML = TAPE_ICON;
$('#fire-tape').onclick = openTapeStart;
