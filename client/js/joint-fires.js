// Joint fires: one fire shared by two Peiskos servers (server/src/joint-fires.ts).
//
// On the server the fire lives on (the host), guests sit at it with LiveKit identities from
// JOINT_GUEST_BASE up, and the fire's voiceJoint lists them by name and group. On the other
// server, the fire is in a hearth like any other, but its call is on the host's LiveKit: there,
// people from elsewhere get ids below zero, and our own people's host identities map back to them.

const JOINT_GUEST_BASE = 1_000_000_000;

const jointChannel = (channelId) => [...state.servers.values()].flatMap((s) => s.channels).find((c) => c.id === channelId);

/** Someone sitting at a fire who isn't in any of our hearths: a guest, or a host's person. */
function visitorOf(id) {
  for (const s of state.servers.values())
    for (const c of s.channels) {
      const p = c.voiceJoint?.people?.find((x) => x.id === id && x.name);
      if (p) return p;
    }
  return null;
}

/** The id a LiveKit participant goes by here. */
function pidOf(identity) {
  const voice = state.voice;
  if (!voice?.joint) return Number(identity);
  if (identity === voice.joint.identity) return state.me.id;
  const p = jointChannel(voice.channelId)?.voiceJoint?.people?.find((x) => x.identity === identity);
  return p ? p.id : -Number(identity);
}

/** The LiveKit identity of someone at our fire, from the id they go by here. */
function identityOf(id) {
  const voice = state.voice;
  if (!voice?.joint) return String(id);
  if (id === state.me.id) return voice.joint.identity;
  if (id < 0) return String(-id);
  return jointChannel(voice.channelId)?.voiceJoint?.people?.find((x) => x.id === id)?.identity ?? String(id);
}

/**
 * Whether the voice key keeper may hand this identity a key, besides the hearth's own members.
 * At another server's fire that server decides who's in the room. At our own fire opened to other
 * groups, guests come in through our server's passes, and it takes out anyone whose code closes.
 */
function jointKeyOk(voice, identity) {
  if (voice.joint) return true;
  return Number(identity) >= JOINT_GUEST_BASE && !!jointChannel(voice.channelId)?.voiceJoint;
}

/** The small "from Lake crew" tag after a visitor's name, or nothing. */
function visitorTag(id) {
  const v = id < 0 || id >= JOINT_GUEST_BASE ? visitorOf(id) : null;
  if (!v?.from) return null;
  const tag = document.createElement('span');
  tag.className = 'visitor-tag';
  tag.textContent = v.from;
  tag.title = `From ${v.from}`;
  return tag;
}

// At another server's fire only your voice goes there: camera, screen, games, sounds and listening
// together all stay with your own hearth's fires.
function applyJointLimits() {
  const joint = !!state.voice?.joint;
  for (const id of ['#fire-camera', '#fire-screen', '#fire-board', '#fire-listen', '#fire-game', '#voice-camera', '#voice-screen'])
    $(id)?.closest('.fc')?.classList.toggle('joint-off', joint) ?? $(id)?.classList.toggle('joint-off', joint);
}

// ---------------------------------------------------------------- host: opening a fire to another group

/** The fire settings part for opening one of this hearth's fires to another server's group. */
function jointFireSettings(s, c) {
  if (!state.jointFires?.host || c.voiceJoint?.role === 'guest' || !can(s, 'burrow')) return '';
  return `<h4>Other groups</h4>
    <p class="small muted">Let a group on another Peiskos server sit at this fire. They talk with their microphone only, and their names show with the group's name.</p>
    <ul class="joint-links" id="joint-links"><li class="muted small">Loading…</li></ul>
    <div class="inline-form"><input id="joint-label" maxlength="32" placeholder="Their group's name" aria-label="Their group's name" /><button type="button" class="btn secondary" id="joint-invite">Invite another group</button></div>
    <div id="joint-code" class="joint-code hidden" role="status"></div>`;
}

function wireJointFireSettings(s, c) {
  const list = $('#joint-links');
  if (!list) return;
  const show = (links) => {
    if (!links.length) return list.replaceChildren(Object.assign(document.createElement('li'), { className: 'muted small', textContent: 'Not open to any other group.' }));
    list.replaceChildren(...links.map((l) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = l.label;
      const here = document.createElement('span');
      here.className = 'small muted';
      here.textContent = l.here ? `${l.here} here now` : 'Nobody here now';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'btn secondary';
      close.textContent = 'Close';
      close.onclick = async () => {
        if (!(await askConfirm(`Close this fire to ${l.label}? Anyone from there leaves it now, and their code stops working.`))) return;
        try { show((await api(`/api/joint/links/${l.id}`, { method: 'DELETE' })).links); } catch (err) { $('#modal-error').textContent = err.message; }
      };
      li.append(name, here, close);
      return li;
    }));
  };
  api(`/api/channels/${c.id}/joint`).then((r) => show(r.links)).catch((err) => { list.replaceChildren(); $('#modal-error').textContent = err.message; });
  $('#joint-invite').onclick = async () => {
    try {
      const r = await api(`/api/channels/${c.id}/joint`, { method: 'POST', body: { label: $('#joint-label').value } });
      show(r.links);
      $('#joint-label').value = '';
      const box = $('#joint-code');
      box.classList.remove('hidden');
      box.innerHTML = `<p class="small">Send this code to them. Their hearth adds it with "Add another group's fire". It's shown only once.</p>
        <div class="inline-form"><input readonly id="joint-code-text" aria-label="Joint fire code" /><button type="button" class="btn" id="joint-copy">Copy</button></div>`;
      $('#joint-code-text').value = r.code;
      $('#joint-code-text').select();
      $('#joint-copy').onclick = async () => {
        try { await navigator.clipboard.writeText(r.code); $('#joint-copy').textContent = 'Copied'; }
        catch { $('#joint-code-text').select(); }
      };
    } catch (err) { $('#modal-error').textContent = err.message; }
  };
}

/** Taking a guest out of our fire, for people who manage voice. */
function guestModTools(pop, s, c, id) {
  if (!s || !c || c.voiceJoint?.role !== 'host' || id < JOINT_GUEST_BASE || !can(s, 'voice')) return;
  const box = document.createElement('div');
  box.className = 'volume-mod';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn danger';
  b.textContent = 'Remove from this fire';
  b.onclick = async () => {
    try { await api(`/api/channels/${c.id}/guests/${id}/remove`, { method: 'POST', body: {} }); closeVolume(); }
    catch (err) { alertError(err); }
  };
  box.append(b);
  pop.append(box);
}

// ---------------------------------------------------------------- guests: adding another group's fire

function openAddJointFire() {
  const s = state.servers.get(state.serverId);
  modal(`<h2>Add another group's fire</h2>
    <form id="joint-add-form">
      <p class="small muted">Paste the code someone from the other group made in their fire's settings. The fire shows up in this hearth, and anyone here can sit at it.</p>
      <label>Code<input id="joint-add-code" required autocomplete="off" spellcheck="false" placeholder="https://their-peiskos.example/joint#…" /></label>
      <label>Name it here<input id="joint-add-name" maxlength="32" placeholder="Their fire's name" /></label>
      <div class="error" id="modal-error"></div>
      <div class="modal-row"><button type="button" class="btn secondary" data-close>Cancel</button><button type="submit" class="btn">Add fire</button></div>
    </form>`);
  $('#joint-add-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const updated = await api(`/api/servers/${s.id}/joint-fires`, { method: 'POST', body: { code: $('#joint-add-code').value, name: $('#joint-add-name').value } });
      state.servers.set(updated.id, updated);
      closeModal();
      renderChannels();
    } catch (err) { $('#modal-error').textContent = err.message; }
  };
}

/** What a fire's sidebar line says about it being shared, or nothing. */
function jointFireNote(c) {
  const j = c.voiceJoint;
  if (j?.role === 'guest') return j.reachable === false ? `On ${j.address}, which isn't answering` : `With ${j.host}`;
  if (j?.role === 'host' && j.open) return 'Open to other groups';
  return '';
}
