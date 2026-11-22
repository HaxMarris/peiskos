// Time capsules: a message, photos and voice notes sealed in a room until a day, then opened
// together at a fire (server/src/capsules.ts). Sealed ones sit beside their fire as a small chest,
// and the room says one is waiting. Whoever opens it opens it for everyone sitting there.

const CAPSULE_DAY = 864e5;
const capsuleDate = (t) => dateFormat('capsuleDate', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(t));
const capsuleReady = (c) => c.opensAt <= Date.now();
const capsuleFire = (s, c) => s?.channels.find((x) => x.id === c.fireId && x.kind === 'voice') ?? null;
const canDropCapsule = (s, c) => c.authorId === state.me.id || can(s, 'messages');

/** "1 photo and a voice note", or "a message" when there are no files. */
function capsuleInside(c) {
  const bits = [];
  if (c.photos) bits.push(c.photos === 1 ? '1 photo' : `${c.photos} photos`);
  if (c.voiceNotes) bits.push(c.voiceNotes === 1 ? 'a voice note' : `${c.voiceNotes} voice notes`);
  if (c.files) bits.push(c.files === 1 ? '1 file' : `${c.files} files`);
  if (!bits.length) return 'a message';
  return bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(', ')} and ${bits.at(-1)}`;
}

/** The chest, drawn the same small beside a fire and big when it opens. */
function capsuleChestSvg() {
  return `<svg class="capsule-svg" viewBox="0 0 72 60" aria-hidden="true">
    <ellipse cx="36" cy="56" rx="30" ry="4" fill="#000" opacity=".35"/>
    <rect x="7" y="26" width="58" height="29" rx="3" fill="#6b4226"/>
    <path d="M7 36h58M7 45h58" stroke="#4a2b17" stroke-width="1.4"/>
    <rect x="16" y="26" width="6" height="29" fill="#c99a4b"/><rect x="50" y="26" width="6" height="29" fill="#c99a4b"/>
    <rect x="7" y="51" width="58" height="4" rx="2" fill="#4a2b17"/>
    <g class="capsule-lid">
      <path d="M7 27V20C7 10 18 5 36 5s29 5 29 15v7Z" fill="#7d4f2e"/>
      <path d="M12 12c6-4 14-5.5 24-5.5" stroke="#9a6a43" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M16 8.6V27h6V6.8ZM50 6.8V27h6V8.6Z" fill="#c99a4b"/>
      <rect x="6" y="24" width="60" height="4" rx="1.5" fill="#4a2b17"/>
    </g>
    <g class="capsule-seal">
      <path class="seal-l" d="M36 21a7 7 0 0 0 0 14l-1.5-4 2-3-2-3Z" fill="#a8322d"/>
      <path class="seal-r" d="M36 21a7 7 0 0 1 0 14l-1.5-4 2-3-2-3Z" fill="#8f2824"/>
      <circle cx="36" cy="28" r="3.2" fill="none" stroke="#d9665c" stroke-width="1.2"/>
    </g>
  </svg>`;
}

// ---- sealing one, from the + menu

function openCapsuleSealer() {
  const channelId = state.channelId;
  const where = roomById(channelId);
  const s = where?.s;
  if (!s || isDm(s) || where.thread) return toast('Time capsules are sealed in a hearth\'s rooms.');
  const files = state.pending.slice();
  if (files.some((p) => p.error)) return notice('Remove the files that failed to upload first.');
  const fires = s.channels.filter((c) => c.kind === 'voice');
  const day = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const inYears = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() + n); return d.getTime(); };
  const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && state.maxUploadBytes);
  let note = null; // { p, seconds } once a voice note is recorded and uploading
  let rec = null;
  modal(`<h2>Seal a time capsule</h2>
    <p class="muted small">Nobody can see what's inside until the day it opens, you included. Then anyone at the fire can open it for everyone there.</p>
    <form id="capsule-form" class="capsule-form">
      <label>Message<textarea id="capsule-text" rows="4" maxlength="4000" placeholder="Write to whoever's at the fire that day"></textarea></label>
      <div class="capsule-files">
        ${files.length ? `<span class="small">${escapeHtml(files.length === 1 ? '1 file from the message box goes in too' : `${files.length} files from the message box go in too`)}</span>` : ''}
        <span id="capsule-note-state" class="small" aria-live="polite"></span>
        ${canRecord ? '<button type="button" class="btn secondary" id="capsule-rec">Record a voice note</button>' : ''}
      </div>
      <fieldset class="capsule-when"><legend>Opens on</legend>
        <div class="quick-times">
          <button type="button" class="btn secondary" data-years="1">In a year</button>
          <button type="button" class="btn secondary" data-years="5">In 5 years</button>
          <button type="button" class="btn secondary" data-years="10">In 10 years</button>
        </div>
        <input type="date" id="capsule-day" required aria-label="Day it opens" value="${day(inYears(1))}" min="${day(Date.now() + CAPSULE_DAY)}" max="${day(inYears(10) - CAPSULE_DAY)}" />
      </fieldset>
      ${fires.length > 1 ? `<label>Opened at<select id="capsule-fire">${fires.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}</select></label>` : ''}
      <div class="error" id="modal-error"></div>
      <div class="modal-row"><button type="button" class="btn secondary" data-close>Cancel</button><button type="submit" class="btn" id="capsule-seal">Seal it</button></div>
    </form>`);
  const text = $('#capsule-text');
  text.value = $('#composer-input').value.trim();
  text.focus();
  $('#modal-card').querySelectorAll('[data-years]').forEach((b) => (b.onclick = () => ($('#capsule-day').value = day(inYears(Number(b.dataset.years)) - (b.dataset.years === '10' ? CAPSULE_DAY : 0)))));
  const noteState = () => {
    const el = $('#capsule-note-state');
    const btn = $('#capsule-rec');
    if (!el) return;
    if (rec) { el.textContent = `Recording ${clock((Date.now() - rec.started) / 1000)}`; btn.textContent = 'Stop'; return; }
    el.textContent = note ? `Voice note, ${clock(note.seconds)}` : '';
    if (btn) btn.textContent = note ? 'Record it again' : 'Record a voice note';
  };
  const stopRec = (keep) => {
    const r = rec;
    if (!r) return;
    rec = null;
    clearInterval(r.timer);
    const seconds = (Date.now() - r.started) / 1000;
    r.rec.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      if (!keep || seconds < 0.8) return noteState();
      const type = (r.rec.mimeType || r.chunks[0]?.type || 'audio/webm').split(';')[0];
      const ext = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' }[type] ?? 'webm';
      const file = new File(r.chunks, `voice-note.${ext}`, { type });
      if (file.size > uploadLimit()) { $('#modal-error') && ($('#modal-error').textContent = 'That recording is too big to keep.'); return noteState(); }
      const p = { file, voiceSeconds: Math.round(seconds * 10) / 10, progress: 0 };
      p.done = uploadFile(channelId, p);
      p.done.catch(() => {});
      note = { p, seconds };
      noteState();
    };
    r.rec.stop();
  };
  if (canRecord) $('#capsule-rec').onclick = async () => {
    if (rec) return stopRec(true);
    let stream;
    try {
      const deviceId = await deviceIdFor('audioinput').catch(() => undefined);
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, ...(deviceId ? { deviceId: { ideal: deviceId } } : {}) } });
    } catch (err) { $('#modal-error').textContent = mediaError(err, 'microphone'); return; }
    if (!$('#capsule-form')) return stream.getTracks().forEach((t) => t.stop());
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t));
    const r = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 48000 } : undefined);
    const chunks = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec = { rec: r, stream, chunks, started: Date.now(), timer: setInterval(() => {
      if (!$('#capsule-form')) return stopRec(false);
      if ((Date.now() - rec.started) / 1000 >= MAX_RECORDING_SECONDS) stopRec(true);
      else noteState();
    }, 250) };
    r.start(1000);
    noteState();
  };
  onModalClose = () => stopRec(false);

  $('#capsule-form').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#modal-error');
    const [y, m, d] = $('#capsule-day').value.split('-').map(Number);
    const opensAt = new Date(y, m - 1, d).getTime();
    if (rec) return (err.textContent = 'Stop the recording first.');
    if (!(opensAt > Date.now())) return (err.textContent = 'Pick a day after today.');
    const btn = $('#capsule-seal');
    btn.disabled = true;
    try {
      const uploaded = await Promise.all(files.map((p) => p.done));
      const voice = note ? [await note.p.done] : [];
      const content = namesToEmoji(text.value.trim());
      const sealed = await api(`/api/channels/${channelId}/capsules`, { method: 'POST', body: {
        content, opensAt,
        attachmentIds: [...uploaded, ...voice].map((a) => a.id),
        spoilerIds: uploaded.filter((a, i) => files[i].spoiler).map((a) => a.id),
        descriptions: Object.fromEntries(uploaded.map((a, i) => [a.id, files[i].alt?.trim()]).filter(([, v]) => v)),
        fireId: $('#capsule-fire') ? Number($('#capsule-fire').value) : undefined,
      } });
      // What went in is gone from the message box.
      if (state.channelId === channelId) {
        state.pending = state.pending.filter((p) => !files.includes(p));
        renderPending();
        if ($('#composer-input').value.trim() === text.value.trim() || !$('#composer-input').value.trim()) { $('#composer-input').value = ''; autosize(); clearDraft(channelId); }
      }
      onModalClose = null;
      closeModal();
      toast(`Sealed. It opens on ${capsuleDate(sealed.opensAt)}.`);
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  };
}

// ---- the note above the message box, and the list it opens

function renderCapsuleNote() {
  const el = $('#capsule-note');
  const where = roomById(state.channelId);
  const here = where && !where.thread ? (where.s.capsules ?? []).filter((c) => c.channelId === state.channelId) : [];
  el.classList.toggle('hidden', !here.length);
  el.classList.toggle('ready', here.some(capsuleReady));
  if (!here.length) return;
  const ready = here.filter(capsuleReady);
  const fire = ready[0] && capsuleFire(where.s, ready[0]);
  el.textContent = ready.length
    ? `${ready.length === 1 ? `A time capsule from ${nameOf(ready[0].authorId, 'someone')} is` : `${ready.length} time capsules are`} ready to open${fire ? ` at ${fire.name}` : ''} · See ${ready.length === 1 ? 'it' : 'them'}`
    : here.length === 1
      ? `A time capsule from ${nameOf(here[0].authorId, 'someone')} opens on ${capsuleDate(here[0].opensAt)} · See it`
      : `${here.length} time capsules sealed here · The next opens on ${capsuleDate(here[0].opensAt)}`;
}
$('#capsule-note').onclick = () => openCapsuleList(state.serverId, { channelId: state.channelId });

/** Sealed capsules in a hearth: in one room, or at one fire. */
function openCapsuleList(serverId, { channelId, fireId } = {}) {
  const render = () => {
    const list = $('#capsule-list');
    const s = state.servers.get(serverId);
    if (!list || !s) return;
    const items = (s.capsules ?? []).filter((c) => (channelId == null || c.channelId === channelId) && (fireId == null || c.fireId === fireId));
    if (!items.length) return (list.innerHTML = '<p class="muted">Nothing sealed here. Seal one from the + menu in a room.</p>');
    list.replaceChildren(...items.map((c) => {
      const el = document.createElement('div');
      el.className = 'capsule-row' + (capsuleReady(c) ? ' ready' : '');
      const room = s.channels.find((x) => x.id === c.channelId);
      const fire = capsuleFire(s, c);
      const atFire = !fire || state.voice?.channelId === fire.id;
      el.innerHTML = `<span class="capsule-row-chest">${capsuleChestSvg()}</span>
        <div class="capsule-row-text"><b>From ${escapeHtml(nameOf(c.authorId, 'someone'))}</b>
          <span class="small">${escapeHtml(capsuleReady(c) ? `Ready since ${capsuleDate(c.opensAt)}` : `Opens on ${capsuleDate(c.opensAt)}`)}</span>
          <span class="small muted">${escapeHtml(`Sealed ${capsuleDate(c.createdAt)} in #${room?.name ?? 'a room'}, with ${capsuleInside(c)}${fire ? `. Opens at ${fire.name}` : ''}`)}</span></div>
        <div class="capsule-row-actions"></div>`;
      const actions = el.querySelector('.capsule-row-actions');
      const button = (label, cls, run) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.textContent = label;
        b.onclick = run;
        actions.append(b);
        return b;
      };
      if (capsuleReady(c) && atFire) button(fire ? 'Open it for everyone here' : 'Open it', 'btn', async (e) => {
        e.currentTarget.disabled = true;
        try { await api(`/api/capsules/${c.id}/open`, { method: 'POST', body: {} }); if (!fire) closeModal(); }
        catch (err) { alertError(err); e.currentTarget.disabled = false; }
      });
      else if (capsuleReady(c) && state.voiceEnabled) button(`Join ${fire.name}`, 'btn', () => { closeModal(); joinVoice(fire.id); });
      if (!capsuleReady(c) && canDropCapsule(s, c)) button('Throw away', 'btn secondary danger', async () => {
        const whose = c.authorId === state.me.id ? 'this time capsule' : `${nameOf(c.authorId, 'their')}'s time capsule`;
        if (!(await askConfirm(`Throw away ${whose}?`, { text: "What's in it is deleted unopened.", ok: 'Throw away', danger: true }))) return;
        try { await api(`/api/capsules/${c.id}`, { method: 'DELETE' }); } catch (err) { alertError(err); }
      });
      return el;
    }));
  };
  modal('<h2>Time capsules</h2><div id="capsule-list" class="card-list"></div>');
  capsuleListRender = render;
  render();
}
let capsuleListRender = null;

// ---- the chest beside the fire

/** Puts a chest by the fire when a capsule opens here, glowing once one is ready. Called by renderFire. */
function capsuleScene(ring, s, ch) {
  const here = s && ch && !isDm(s) ? (s.capsules ?? []).filter((c) => c.fireId === ch.id) : [];
  let el = ring.querySelector('.capsule-chest');
  if (!here.length) return el?.remove();
  if (!el) {
    el = document.createElement('button');
    el.type = 'button';
    el.className = 'capsule-chest';
    el.innerHTML = `${capsuleChestSvg()}<span class="capsule-chest-label"></span><span class="capsule-chest-count"></span>`;
    ring.append(el);
  }
  const ready = here.filter(capsuleReady);
  el.classList.toggle('ready', ready.length > 0);
  const label = ready.length ? (ready.length === 1 ? 'Time capsule' : `${ready.length} time capsules`) : `Opens ${dateFormat('capsuleShort', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(here[0].opensAt))}`;
  el.querySelector('.capsule-chest-label').textContent = label;
  el.querySelector('.capsule-chest-count').textContent = here.length > 1 ? here.length : '';
  el.setAttribute('aria-label', ready.length ? `${label} ready to open. See ${ready.length === 1 ? 'it' : 'them'}` : `${here.length === 1 ? 'A time capsule' : `${here.length} time capsules`} sealed at this fire. ${label}`);
  el.onclick = (e) => { e.stopPropagation(); openCapsuleList(s.id, { fireId: ch.id }); };
  capsulePlace(ring, el);
}

/** On the ground in front of the fire and a little to the right, clear of the seats around it. */
function capsulePlace(ring, el = ring.querySelector('.capsule-chest')) {
  if (!el) return;
  const ground = ring.querySelector('.fire-pit.back, .fire-pool');
  const g = parseFloat(ground?.style.top) || ring.clientHeight * 0.68;
  const phone = matchMedia('(max-width: 760px)').matches;
  el.style.left = `${ring.clientWidth / 2 + (phone ? 42 : 64)}px`;
  el.style.top = `${g + (phone ? 52 : 78)}px`;
}
new ResizeObserver(() => capsulePlace($('#fire-ring'))).observe($('.fire-ring-wrap'));

// ---- opening, for everyone at the fire

function showCapsuleOpening(ev) {
  const m = ev.message;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  modal(`<div class="capsule-open${still ? ' still' : ''}">
      <div class="capsule-open-chest">${capsuleChestSvg()}<span class="capsule-glow" aria-hidden="true"></span></div>
      <div class="capsule-open-body">
        <h2>From ${escapeHtml(m.author)}</h2>
        <p class="capsule-open-when">Sealed ${escapeHtml(capsuleDate(m.capsule.sealedAt))}. Opened by ${escapeHtml(ev.openedBy === state.me.id ? 'you' : nameOf(ev.openedBy, 'someone'))}.</p>
        <div class="capsule-open-content content">${formatContent(m.content)}</div>
      </div>
    </div>`, 'capsule-open-card');
  const body = $('#modal-card').querySelector('.capsule-open-body');
  if (!m.content) body.querySelector('.capsule-open-content').remove();
  if (m.attachments?.length) body.append(renderAttachments(m.attachments));
  playSound('message');
}

// A capsule's message in the room says where it came from.
function renderCapsuleBanner(m) {
  const el = document.createElement('div');
  el.className = 'capsule-banner';
  el.innerHTML = `<span class="capsule-banner-chest">${capsuleChestSvg()}</span><span>Time capsule, sealed ${escapeHtml(capsuleDate(m.capsule.sealedAt))}. Opened by ${escapeHtml(nameOf(m.capsule.openedBy, 'someone'))}.</span>`;
  return el;
}

// Capsules become ready with nobody touching anything, so once a minute the room's note and the
// fire look again and redraw when that changed.
let capsuleReadyKey = '';
setInterval(() => {
  if (!state.me) return;
  const key = [...state.servers.values()].flatMap((s) => (s.capsules ?? []).filter(capsuleReady).map((c) => c.id)).join();
  if (key === capsuleReadyKey) return;
  capsuleReadyKey = key;
  renderCapsuleNote();
  renderFire();
}, 60e3);

/** The hearth changed (a capsule sealed, opened or thrown away): the note, the fire and an open list follow. */
function capsulesChanged() {
  renderCapsuleNote();
  if ($('#capsule-list')) capsuleListRender?.();
}
