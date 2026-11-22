// The movie theater at the fire (server/src/theater.ts). Each hearth keeps a shelf of movies,
// MP4 files people add; one plays at a fire for everyone there, in step. Peiskos keeps what's on
// and where it was at a moment in time; each app works out where it should be now and nudges its
// own player there, like listening together. The player keeps going while you're back at the fire,
// so you can talk over it; leaving the fire stops it.

const THEATER_ICON = '<svg viewBox="0 0 24 24"><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-6v2h3v2H7v-2h3v-2H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm6 3v6l5-3-5-3Z"/></svg>';
const theater = { channelId: null, state: null, at: 0, shelf: null, upload: null, movieId: null, blocked: false };
// off: nothing on. loading: the player is fetching the movie. blocked: the browser wouldn't start it
// without a tap. playing / paused: lined up with everyone else.
const theaterPhase = phaseMachine('theater', 'off', { el: () => $('.theater-view') });
// idle: nothing being added. checking: seeing that this browser plays the file. uploading: sending it.
const movieUpPhase = phaseMachine('movieUpload', 'idle', { el: () => $('#theater-shelf') });
const PIECE_BYTES = 8 * 1024 * 1024;

const sendTheater = (msg) => state.ws?.readyState === WebSocket.OPEN && state.ws.send(JSON.stringify({ type: 'theater', ...msg }));
const theaterVideo = () => $('#theater-video');
const theaterHearth = () => fireServer();
const theaterBoss = () => can(theaterHearth(), 'voice');

/** Where the movie should be now, in seconds. */
function theaterTarget() {
  const st = theater.state;
  if (!st) return 0;
  return Math.min(st.movie.duration, st.position + (st.playing ? (performance.now() - theater.at) / 1000 : 0));
}

function openTheater() {
  if (!state.voice) return;
  if (!state.stageOpen) openStage();
  state.stageShow = 'theater';
  renderStage();
  renderTheater();
  if (!theater.state) loadShelf();
}

function closeTheater() {
  if (state.stageShow === 'theater') {
    state.stageShow = 'fire';
    renderStage();
  }
}

/** Leaving the fire stops the movie on this device (it goes on for everyone still there). */
function stopTheater() {
  closeTheater();
  theater.channelId = null;
  theater.state = null;
  theater.movieId = null;
  const v = theaterVideo();
  v.pause();
  v.removeAttribute('src');
  v.load();
  theaterPhase.to('off');
  renderTheater();
}

function onTheaterState(ev) {
  if (state.voice?.channelId !== ev.channelId) return;
  const before = theater.state;
  theater.channelId = ev.channelId;
  theater.state = ev.state;
  theater.at = performance.now();
  if (!ev.state) {
    if (before) fireNote('The movie stopped');
    theater.movieId = null;
    const v = theaterVideo();
    v.pause();
    v.removeAttribute('src');
    v.load();
    theaterPhase.to('off');
    if (state.stageShow === 'theater') loadShelf();
    return renderTheater();
  }
  if (theater.movieId !== ev.state.movie.id) {
    if (!before || before.movie.id !== ev.state.movie.id) fireNote(`${ev.state.by === state.me.id ? 'You' : nameOf(ev.state.by)} put on ${ev.state.movie.name}`);
    theater.movieId = ev.state.movie.id;
    theater.blocked = false;
    theaterPhase.to('loading');
    const v = theaterVideo();
    v.src = state.serverUrl + ev.state.movie.url;
    v.load();
  }
  syncTheater(true);
  renderTheater();
}

/** Lines the player up with everyone else: playing or not, the same spot, your volume. */
function syncTheater(force = false) {
  const st = theater.state;
  const v = theaterVideo();
  if (!st || !v.src) return;
  v.volume = Math.max(0, Math.min(1, voicePrefs.movieVolume * voicePrefs.outputVolume));
  v.muted = !!state.voice?.deafened;
  if (v.readyState < 1) return; // the length and first frame aren't in yet; 'loadedmetadata' comes back here
  const target = theaterTarget();
  const off = v.currentTime - target;
  if (Math.abs(off) > 1.5 || (force && Math.abs(off) > 0.4) || (!st.playing && Math.abs(off) > 0.25)) {
    v.currentTime = target;
    v.playbackRate = 1;
  } else if (st.playing) {
    // A little behind or ahead: catch up by playing a touch faster or slower, rather than jumping.
    v.playbackRate = Math.abs(off) < 0.15 ? 1 : off < 0 ? 1.05 : 0.95;
  }
  if (st.playing && v.paused && !st.ended) {
    v.play().then(() => { theater.blocked = false; theaterPhase.to('playing'); renderTheater(); }).catch((err) => {
      if (err?.name !== 'NotAllowedError') return;
      theater.blocked = true;
      theaterPhase.to('blocked');
      renderTheater();
    });
  } else if (!st.playing) {
    if (!v.paused) v.pause();
    theaterPhase.to('paused');
  } else if (!v.paused) theaterPhase.to('playing');
}
setInterval(() => { if (theater.state?.playing) { syncTheater(); renderTheaterTime(); } }, 1000);

async function loadShelf() {
  const s = theaterHearth();
  if (!s) return;
  try {
    theater.shelf = await api(`/api/servers/${s.id}/movies`);
  } catch (err) {
    theater.shelf = { movies: [], error: err.message };
  }
  renderTheater();
}

const movieLength = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${Math.max(1, m)} min`;
};
const theaterClock = (sec) => sec >= 3600 ? `${Math.floor(sec / 3600)}:${clock(sec % 3600).padStart(5, '0')}` : clock(sec);

function renderTheater() {
  const st = theater.state;
  const view = $('.theater-view');
  view.classList.toggle('showing', !!st);
  $('#fire-theater').classList.toggle('on', !!st);
  renderTheaterPanel();
  $('#theater-title').textContent = st ? st.movie.name : 'Movie night';
  const v = theaterVideo();
  if (st?.movie.width && st.movie.height) $('#theater-screen').style.aspectRatio = `${st.movie.width} / ${st.movie.height}`;
  else $('#theater-screen').style.aspectRatio = '';
  $('#theater-tap').classList.toggle('hidden', !theater.blocked);
  $('#theater-controls').classList.toggle('hidden', !st);
  $('#theater-shelf').classList.toggle('hidden', !!st);
  if (st) {
    $('#theater-toggle').innerHTML = st.playing ? PAUSE_ICON : PLAY_ICON;
    $('#theater-toggle').title = st.playing ? 'Pause for everyone' : 'Play for everyone';
    $('#theater-toggle').setAttribute('aria-label', $('#theater-toggle').title);
    $('#theater-by').textContent = `Put on by ${st.by === state.me.id ? 'you' : nameOf(st.by)}`;
    $('#theater-stop').classList.toggle('hidden', st.by !== state.me.id && !theaterBoss());
    $('#theater-seek').max = String(Math.floor(st.movie.duration));
    renderTheaterTime();
  } else renderShelf();
  renderTheaterSeats();
  v.classList.toggle('hidden', !st);
}

function renderTheaterTime() {
  const st = theater.state;
  if (!st) return;
  const t = theaterTarget();
  $('#theater-time').textContent = `${theaterClock(t)} / ${theaterClock(st.movie.duration)}`;
  const seek = $('#theater-seek');
  if (!seek.matches(':active')) seek.value = String(Math.floor(t));
  seek.setAttribute('aria-valuetext', `${theaterClock(t)} of ${theaterClock(st.movie.duration)}`);
}

/** The people at the fire, in the front row. */
function renderTheaterSeats() {
  const s = theaterHearth();
  const ch = s?.channels.find((c) => c.id === state.voice?.channelId);
  const ids = ch?.voiceUsers ?? [];
  $('#theater-seats').replaceChildren(...ids.slice(0, 16).map((id) => {
    const seat = document.createElement('span');
    seat.className = 'theater-seat';
    const av = document.createElement('span');
    av.className = 'avatar';
    const m = s.members?.find((x) => x.id === id);
    setAvatar(av, m?.username ?? nameOf(id), avatarOf(id, m?.avatar ?? null));
    seat.title = nameOf(id);
    seat.append(av);
    return seat;
  }));
}

function renderTheaterPanel() {
  const st = theater.state;
  const panel = $('#theater-panel');
  panel.classList.toggle('hidden', !st);
  if (!st) return;
  $('#theater-panel-title').textContent = st.movie.name;
  $('#theater-panel-sub').textContent = `${st.playing ? 'Playing' : st.ended ? 'Finished' : 'Paused'} at ${theaterClock(theaterTarget())}`;
}

function renderShelf() {
  const shelf = theater.shelf;
  const list = $('#theater-movies');
  const up = theater.upload;
  $('#theater-shelf-note').textContent = shelf?.error ?? (shelf
    ? (shelf.movies.length ? 'Pick a movie to play it for everyone at the fire.' : 'No movies on the shelf yet. Add an MP4 to watch it together.')
    : 'Loading the shelf…');
  const canAdd = !!shelf?.canAdd;
  $('#theater-add').classList.toggle('hidden', !canAdd || !!up);
  $('#theater-add-hint').classList.toggle('hidden', !canAdd);
  if (shelf) $('#theater-add-hint').textContent = `MP4 with H.264 video and AAC sound, up to ${formatSize(shelf.maxBytes)}. Movies nobody puts on for ${shelf.keepDays} days leave the shelf.`;
  $('#theater-upload').classList.toggle('hidden', !up);
  if (up) {
    $('#theater-upload-name').textContent = up.name;
    $('#theater-upload-state').textContent = up.error ?? (movieUpPhase.is('checking') ? 'Checking the file…' : `${Math.floor(up.progress * 100)}% of ${formatSize(up.size)}`);
    $('#theater-upload-bar').value = up.progress;
    $('#theater-upload-cancel').textContent = up.error ? 'Close' : 'Cancel';
  }
  list.replaceChildren(...(shelf?.movies ?? []).map((m) => {
    const li = document.createElement('li');
    const play = document.createElement('button');
    play.className = 'theater-movie';
    play.setAttribute('aria-label', `Play ${m.name} for everyone`);
    const name = document.createElement('b');
    name.textContent = m.name;
    const meta = document.createElement('span');
    meta.className = 'small muted';
    meta.textContent = `${movieLength(m.duration)}, added by ${m.by === state.me.id ? 'you' : nameOf(m.by, 'someone who left')}`;
    play.append(name, meta);
    play.onclick = () => sendTheater({ action: 'start', movieId: m.id });
    li.append(play);
    if (m.by === state.me.id || shelf.canRemoveAny) {
      const remove = document.createElement('button');
      remove.className = 'link-btn danger-link';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${m.name} from the shelf`);
      remove.onclick = async () => {
        if (!(await ask({ title: `Remove ${m.name}?`, text: 'It leaves the shelf for everyone in the hearth.', ok: 'Remove', danger: true }))) return;
        try { await api(`/api/movies/${m.id}`, { method: 'DELETE' }); } catch (err) { alertError(err); }
        loadShelf();
      };
      li.append(remove);
    }
    return li;
  }));
}

/** Whether this browser can play the file at all, before anything is sent. */
function playsHere(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (ok) => { clearTimeout(timer); URL.revokeObjectURL(url); v.removeAttribute('src'); resolve(ok); };
    const timer = setTimeout(() => done(null), 15000); // can't tell; the server checks anyway
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => done(v.videoWidth > 0);
    v.onerror = () => done(false);
    v.src = url;
  });
}

const CONVERT_HINT = 'Convert it to MP4 with H.264 video and AAC sound (HandBrake\'s "Fast 1080p30" does this), then try again.';

async function addMovie(file) {
  const s = theaterHearth();
  if (!s || theater.upload) return;
  const up = theater.upload = { name: file.name, size: file.size, progress: 0, error: null, xhr: null, id: null, cancelled: false };
  const fail = (message) => {
    up.error = message;
    movieUpPhase.to('failed');
    renderTheater();
  };
  movieUpPhase.to('checking');
  renderTheater();
  if (theater.shelf?.maxBytes && file.size > theater.shelf.maxBytes) return fail(`Movies can be up to ${formatSize(theater.shelf.maxBytes)}.`);
  if ((await playsHere(file)) === false) {
    // Some browsers (Chromium on Linux, for one) can't play H.264 that every other browser can, so
    // it's a question, not a no. Peiskos checks the file itself once it's sent.
    const go = await ask({ title: "This browser can't play that file", text: `It may not play for others either. ${CONVERT_HINT}`, ok: 'Add it anyway' });
    if (!go) { theater.upload = null; movieUpPhase.to('idle'); return renderTheater(); }
  }
  if (up.cancelled) return;
  try {
    const started = await api(`/api/servers/${s.id}/movies`, { method: 'POST', body: { name: file.name, size: file.size } });
    up.id = started.uploadId;
    movieUpPhase.to('uploading');
    let at = 0, tries = 0;
    while (at < file.size) {
      if (up.cancelled) return;
      try {
        const r = await sendPiece(up, file.slice(at, Math.min(file.size, at + PIECE_BYTES)), at);
        at = r.received;
        tries = 0;
        if (r.movie) {
          theater.upload = null;
          movieUpPhase.to('idle');
          toast(`${r.movie.name} is on the shelf.`);
          return loadShelf();
        }
      } catch (err) {
        // A dropped connection tries the same piece again, a few times; anything else stops here.
        if (up.cancelled) return;
        if (err.received !== undefined) { at = err.received; continue; }
        if (!err.retry || ++tries > 5) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** tries));
      }
    }
  } catch (err) {
    if (!up.cancelled) fail(err.message);
  }
}

function sendPiece(up, blob, at) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    up.xhr = xhr;
    xhr.open('PUT', `${state.serverUrl}/api/movie-uploads/${up.id}?at=${at}`);
    xhr.setRequestHeader('authorization', 'Bearer ' + state.token);
    xhr.upload.onprogress = (e) => { up.progress = (at + e.loaded) / up.size; renderTheater(); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 200) { up.progress = data.received / up.size; return resolve(data); }
      const err = new Error(data.error || `Upload failed (${xhr.status})`);
      if (xhr.status === 409 && typeof data.received === 'number') err.received = data.received;
      if (xhr.status >= 500 && xhr.status !== 507) err.retry = true;
      reject(err);
    };
    xhr.onerror = () => reject(Object.assign(new Error("Couldn't reach the server, so the movie stopped uploading. Try again."), { retry: true }));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(blob);
  });
}

function cancelMovieUpload() {
  const up = theater.upload;
  if (!up) return;
  up.cancelled = true;
  up.xhr?.abort();
  if (up.id && !up.error) api(`/api/movie-uploads/${up.id}`, { method: 'DELETE' }).catch(() => {});
  theater.upload = null;
  movieUpPhase.to('idle');
  renderTheater();
}

$('#fire-theater').innerHTML = THEATER_ICON;
$('#fire-theater').onclick = openTheater;
$('#theater-panel-open').onclick = openTheater;
$('#theater-back').onclick = closeTheater;
$('#theater-toggle').onclick = () => sendTheater({ action: theater.state?.playing ? 'pause' : 'play' });
$('#theater-back10').onclick = () => sendTheater({ action: 'seek', position: Math.max(0, theaterTarget() - 10) });
$('#theater-fwd10').onclick = () => sendTheater({ action: 'seek', position: theaterTarget() + 10 });
$('#theater-seek').onchange = (e) => sendTheater({ action: 'seek', position: Number(e.target.value) });
$('#theater-stop').onclick = () => sendTheater({ action: 'stop' });
$('#theater-tap').onclick = () => { theater.blocked = false; theaterVideo().play().catch(() => {}); syncTheater(true); renderTheater(); };
$('#theater-full').onclick = () => {
  const screen = $('#theater-screen');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (screen.requestFullscreen) screen.requestFullscreen().catch(() => {});
  else theaterVideo().webkitEnterFullscreen?.(); // iPhone: only the video itself goes full screen
};
$('#theater-add').onclick = () => $('#theater-file').click();
$('#theater-file').onchange = (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) addMovie(file);
};
$('#theater-upload-cancel').onclick = cancelMovieUpload;
$('#theater-volume').value = String(Math.round(voicePrefs.movieVolume * 100));
$('#theater-volume').oninput = (e) => { voicePrefs.movieVolume = Number(e.target.value) / 100; syncTheater(); };
$('#theater-volume').onchange = saveVoicePrefs;
{
  const v = theaterVideo();
  v.addEventListener('loadedmetadata', () => syncTheater(true));
  v.addEventListener('waiting', () => { if (theater.state?.playing) theaterPhase.to('loading'); });
  v.addEventListener('playing', () => theaterPhase.to('playing'));
  // At the end it stops for everyone, rather than starting over.
  v.addEventListener('ended', () => { if (theater.state?.playing) sendTheater({ action: 'ended', movieId: theater.state.movie.id }); });
  v.addEventListener('error', () => {
    if (!theater.state) return;
    toast("Couldn't load the movie. It may have been taken off the shelf.");
  });
}
