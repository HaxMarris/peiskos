// Lanterns: lamps you build (an ESP32 and a ring of LEDs) that glow while friends are at a fire
// and flicker while someone there talks. Set up and changed here, in your account's Lanterns tab.

const LANTERN_GUIDE = 'https://github.com/HaxMarris/peiskos/blob/main/lantern/README.md';
const LANTERN_WHEN = [
  ['both', 'Both', 'Glows while someone is at the fire, flickers while they talk.'],
  ['fire', 'At the fire', 'Glows while someone is at the fire.'],
  ['talk', 'Talking', 'Lights up only while someone is talking.'],
];
let lanternData = { lanterns: [], fires: [] };
const lanternCodes = new Map(); // lantern id -> its setup code, while this tab is open
let lanternWait = 0;

function lanternSettings() {
  return `<h3>Lanterns</h3>
    <p class="small muted">A lantern is a small lamp that lights up when friends are at a fire, so you know without opening Peiskos. You build it from an ESP32 board and a ring of LEDs, about $10 of parts. <a href="${LANTERN_GUIDE}" target="_blank" rel="noopener">How to build one</a></p>
    <p class="small muted">Lanterns only know whether someone is at a fire or talking. They never get names or sound. You being at a fire doesn't light your own lantern.</p>
    <div id="lantern-box">${placeholder('lines', 2)}</div>`;
}

async function loadLanterns() {
  const box = $('#lantern-box');
  if (!box) return;
  try { lanternData = await api('/api/lanterns'); } catch (err) { box.innerHTML = `<span class="error">${escapeHtml(err.message)}</span>`; return; }
  renderLanterns();
  // A lantern being set up shows as connected here once it is.
  clearTimeout(lanternWait);
  if (lanternData.lanterns.some((l) => !l.paired && l.codeUntil && lanternCodes.has(l.id)))
    lanternWait = setTimeout(() => { if (document.body.contains(box) && !box.closest('.hidden')) loadLanterns(); }, 4000);
}

/** The little glass on each lantern's row, showing what the lamp shows now. */
function lanternGlass(l) {
  const light = l.light;
  const lit = !!light && (light.glow || light.flicker);
  const look = !l.paired ? 'new' : !l.online ? 'offline' : lit ? (light.flicker ? 'flicker' : 'glow') : 'dark';
  const said = { new: 'Not set up', offline: 'Offline', flicker: 'Flickering: someone is talking', glow: 'Glowing: someone is at the fire', dark: 'Dark: nobody at its fires' }[look];
  return `<span class="lantern-glass" data-state="${look}" style="--lantern-level:${lit ? Math.max(0.25, light.level / 255) : 0}" role="img" aria-label="${escapeHtml(said)}"><i></i></span>`;
}

function lanternStatus(l) {
  if (!l.paired) return l.codeUntil ? 'Waiting to be set up' : 'Not set up';
  if (l.online) {
    const n = l.light?.people ?? 0;
    return !l.enabled ? 'Online, turned off' : n ? `Online, ${n} ${n === 1 ? 'person' : 'people'} at its fires` : 'Online, nobody at its fires';
  }
  return l.lastSeenAt ? `Offline, last seen ${formatDay(l.lastSeenAt)}` : 'Offline';
}

function lanternSetupSteps(l) {
  const code = lanternCodes.get(l.id);
  const host = new URL(state.serverUrl).host;
  if (!code) return `<p class="small muted">Make a setup code to connect this lantern.</p>
    <div><button type="button" class="btn secondary" data-lantern-code="${l.id}">Make a setup code</button></div>`;
  return `<ol class="lantern-steps">
      <li>Plug the lantern in. It glows blue when it's ready to set up.</li>
      <li>On your phone, join the Wi-Fi called <b>Peiskos Lantern</b>. A setup page opens.</li>
      <li>Pick your home Wi-Fi and type its password.</li>
      <li>Under Peiskos server, type <b>${escapeHtml(host)}</b>.</li>
      <li>Under Setup code, type <b class="lantern-code">${escapeHtml(code)}</b></li>
    </ol>
    <p class="small muted">The code works once, for 15 minutes. The lantern glows white for a moment when it's connected.</p>`;
}

function lanternFires(l) {
  if (!lanternData.fires.length) return '<p class="small muted">None of your hearths has a fire yet.</p>';
  const hearths = new Map();
  for (const f of lanternData.fires) {
    if (!hearths.has(f.serverId)) hearths.set(f.serverId, { name: f.serverName, fires: [] });
    hearths.get(f.serverId).fires.push(f);
  }
  const picked = new Set(l.fireIds);
  return `<div class="kind-choice">
      <label><input type="radio" name="lantern-all-${l.id}" value="all" data-lantern-all="${l.id}" ${l.allFires ? 'checked' : ''} /> All my fires</label>
      <label><input type="radio" name="lantern-all-${l.id}" value="some" data-lantern-all="${l.id}" ${l.allFires ? '' : 'checked'} /> Only these</label>
    </div>
    <div class="lantern-fires ${l.allFires ? 'hidden' : ''}">
      ${[...hearths.values()].map((h) => `<fieldset><legend>${escapeHtml(h.name)}</legend>
        ${h.fires.map((f) => `<label class="check"><input type="checkbox" data-lantern-fire="${l.id}" value="${f.id}" ${picked.has(f.id) ? 'checked' : ''} /> ${escapeHtml(f.name)}</label>`).join('')}
      </fieldset>`).join('')}
    </div>`;
}

function lanternRow(l) {
  const head = `<div class="lantern-head">
      ${lanternGlass(l)}
      <span class="lantern-title"><b>${escapeHtml(l.name)}</b><span class="small muted">${escapeHtml(lanternStatus(l))}</span></span>
    </div>`;
  if (!l.paired) return `<li class="lantern" data-lantern="${l.id}">${head}
      ${lanternSetupSteps(l)}
      <div class="lantern-actions">
        ${lanternCodes.has(l.id) ? `<button type="button" class="link-btn" data-lantern-code="${l.id}">Make a new code</button>` : ''}
        <button type="button" class="link-btn danger-link" data-lantern-remove="${l.id}">Remove</button>
      </div>
    </li>`;
  return `<li class="lantern" data-lantern="${l.id}">${head}
      <label class="check"><input type="checkbox" data-lantern-on="${l.id}" ${l.enabled ? 'checked' : ''} /> Light up</label>
      <fieldset class="lantern-group" ${l.enabled ? '' : 'disabled'}>
        <legend>Lights up for</legend>
        <div class="kind-choice lantern-when">${LANTERN_WHEN.map(([v, label]) => `<label><input type="radio" name="lantern-when-${l.id}" value="${v}" data-lantern-when="${l.id}" ${l.lightWhen === v ? 'checked' : ''} /> ${label}</label>`).join('')}</div>
        <span class="small muted" id="lantern-when-hint-${l.id}">${LANTERN_WHEN.find(([v]) => v === l.lightWhen)?.[2] ?? ''}</span>
      </fieldset>
      <fieldset class="lantern-group" ${l.enabled ? '' : 'disabled'}>
        <legend>Fires</legend>
        ${lanternFires(l)}
      </fieldset>
      <label class="lantern-range" ${l.enabled ? '' : 'aria-disabled="true"'}>Brightness <span class="range-value" id="lantern-bright-val-${l.id}">${l.brightness}%</span>
        <input type="range" min="5" max="100" step="5" value="${l.brightness}" data-lantern-bright="${l.id}" ${l.enabled ? '' : 'disabled'} /></label>
      <label>Name<input maxlength="32" value="${escapeHtml(l.name)}" data-lantern-name="${l.id}" /></label>
      <div class="lantern-actions">
        <button type="button" class="btn secondary" data-lantern-blink="${l.id}" ${l.online ? '' : 'disabled'}>Blink it</button>
        <button type="button" class="link-btn" data-lantern-code="${l.id}">Set up again</button>
        <button type="button" class="link-btn danger-link" data-lantern-remove="${l.id}">Remove</button>
      </div>
    </li>`;
}

function renderLanterns() {
  const box = $('#lantern-box');
  if (!box) return;
  const list = lanternData.lanterns;
  box.innerHTML = `${list.length ? `<ul class="plain-list lantern-list">${list.map(lanternRow).join('')}</ul>` : '<p class="small muted">No lanterns yet.</p>'}
    <form id="lantern-add" class="lantern-add">
      <label>Name<input id="lantern-new-name" maxlength="32" placeholder="e.g. Bookshelf" /></label>
      <button type="submit" class="btn">Add a lantern</button>
    </form>
    <div class="error" id="lantern-error" role="alert"></div>`;
  wireLanterns(box);
}

function wireLanterns(box) {
  const fail = (err) => { $('#lantern-error').textContent = err.message; };
  const replace = (l) => {
    lanternData.lanterns = lanternData.lanterns.map((x) => (x.id === l.id ? l : x));
  };
  const patch = async (id, body, rerender = true) => {
    $('#lantern-error').textContent = '';
    try {
      const { lantern } = await api(`/api/lanterns/${id}`, { method: 'PATCH', body });
      replace(lantern);
      if (rerender) renderLanterns();
      else {
        // Keep focus where it is: only the glass and the status line change.
        const row = box.querySelector(`[data-lantern="${id}"]`);
        row?.querySelector('.lantern-head')?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: lanternRow(lantern) }).querySelector('.lantern-head'));
      }
    } catch (err) { fail(err); loadLanterns(); }
  };
  $('#lantern-add').onsubmit = async (e) => {
    e.preventDefault();
    if (e.submitter) e.submitter.disabled = true;
    try {
      const { lantern, code } = await api('/api/lanterns', { method: 'POST', body: { name: $('#lantern-new-name').value } });
      lanternCodes.set(lantern.id, code);
      lanternData.lanterns.push(lantern);
      renderLanterns();
    } catch (err) { fail(err); if (e.submitter) e.submitter.disabled = false; }
  };
  for (const b of box.querySelectorAll('[data-lantern-code]')) b.onclick = async () => {
    const id = Number(b.dataset.lanternCode);
    const l = lanternData.lanterns.find((x) => x.id === id);
    if (l?.paired && !(await askConfirm(`Set up ${l.name} again? It goes offline until you type the new code into it.`, { ok: 'Make a code' }))) return;
    try {
      const { lantern, code } = await api(`/api/lanterns/${id}/code`, { method: 'POST' });
      lanternCodes.set(id, code);
      replace(lantern);
      renderLanterns();
    } catch (err) { fail(err); }
  };
  for (const b of box.querySelectorAll('[data-lantern-remove]')) b.onclick = async () => {
    const id = Number(b.dataset.lanternRemove);
    const l = lanternData.lanterns.find((x) => x.id === id);
    if (!(await askConfirm(`Remove ${l?.name ?? 'this lantern'}? It stops lighting up until you set it up again.`, { ok: 'Remove', danger: true }))) return;
    try {
      await api(`/api/lanterns/${id}`, { method: 'DELETE' });
      lanternData.lanterns = lanternData.lanterns.filter((x) => x.id !== id);
      lanternCodes.delete(id);
      renderLanterns();
    } catch (err) { fail(err); }
  };
  for (const b of box.querySelectorAll('[data-lantern-blink]')) b.onclick = async () => {
    try { await api(`/api/lanterns/${b.dataset.lanternBlink}/blink`, { method: 'POST' }); toast('Blinked.'); } catch (err) { fail(err); }
  };
  for (const c of box.querySelectorAll('[data-lantern-on]')) c.onchange = () => patch(Number(c.dataset.lanternOn), { enabled: c.checked });
  for (const r of box.querySelectorAll('[data-lantern-when]')) r.onchange = () => {
    const id = Number(r.dataset.lanternWhen);
    $(`#lantern-when-hint-${id}`).textContent = LANTERN_WHEN.find(([v]) => v === r.value)?.[2] ?? '';
    patch(id, { lightWhen: r.value }, false);
  };
  for (const r of box.querySelectorAll('[data-lantern-all]')) r.onchange = () => {
    const id = Number(r.dataset.lanternAll);
    const all = r.value === 'all';
    r.closest('.lantern-group').querySelector('.lantern-fires').classList.toggle('hidden', all);
    patch(id, { allFires: all }, false);
  };
  for (const c of box.querySelectorAll('[data-lantern-fire]')) c.onchange = () => {
    const id = Number(c.dataset.lanternFire);
    const ids = [...box.querySelectorAll(`[data-lantern-fire="${id}"]:checked`)].map((x) => Number(x.value));
    patch(id, { fireIds: ids }, false);
  };
  for (const s of box.querySelectorAll('[data-lantern-bright]')) {
    const id = Number(s.dataset.lanternBright);
    s.oninput = () => { $(`#lantern-bright-val-${id}`).textContent = `${s.value}%`; };
    s.onchange = () => patch(id, { brightness: Number(s.value) }, false);
  }
  for (const i of box.querySelectorAll('[data-lantern-name]')) i.onchange = () => {
    if (i.value.trim()) patch(Number(i.dataset.lanternName), { name: i.value });
  };
}
