// More to do with skins (the casino's Cases tab): today's top pulls in the hearth, trading up five
// skins of a rarity for one of the next (like CS's contracts), and the upgrader, which puts skins on
// a better one at a chance. Plus the Pets tab: premium pets bought with chips, by your seat at the
// hearth's fires. The server decides every outcome; this only shows it.

// ---- today's top pulls: the best skins out of cases in this hearth since midnight (yours, wherever you are)

let topPulls = null; // { at, rows }
const startOfDay = () => new Date().setHours(0, 0, 0, 0);

async function loadTopPulls(force = false) {
  if (!force && topPulls && Date.now() - topPulls.at < 30_000) return;
  const hearth = casino.hearthId;
  try {
    const rows = await api(casinoApi(`/pulls?since=${startOfDay()}`));
    if (hearth !== casino.hearthId) return;
    topPulls = { at: Date.now(), rows };
    renderTopPulls();
  } catch { /* the cases still work without it */ }
}

function renderTopPulls() {
  const box = $('#top-pulls');
  if (!box || !casino.data) return;
  const rows = topPulls?.rows;
  box.innerHTML = `<h4>Today's top pulls <span class="small muted">in this hearth</span></h4>${!rows ? '<p class="small muted">Looking…</p>'
    : !rows.length ? '<p class="small muted">Nothing opened yet today. The first good pull goes here.</p>'
    : `<div class="pull-row">${rows.map((r, i) => {
      const skin = skinById(r.skinId);
      if (!skin) return '';
      return `<div class="pull">${itemTile(skin, `${floatLine(r.float)}<span class="item-meta small">${r.stattrak ? '<span class="stattrak">ST</span> ' : ''}${chipValue(r.value)}</span>`, { float: r.float })}
        <span class="pull-who"><span class="pull-rank">${i + 1}</span><span class="avatar xs" data-avatar="${r.userId}"></span><span>${escapeHtml(nameOf(r.userId, 'Someone'))}</span></span></div>`;
    }).join('')}</div>`}`;
  drawAvatars(box);
}

// ---- trade up

const tradePicked = []; // item ids, in the order they went in
let lastTrade = null; // what the last trade up made

const rarityOf = (item) => skinById(item.skinId)?.rarity;
const wearValueOf = (float) => wearOf(float, casino.data.wears).value;
const stattrakValue = 1.6;

function renderTradeUp() {
  const rules = casino.data.tradeUp;
  const n = rules.count;
  for (let k = tradePicked.length - 1; k >= 0; k--) {
    if (!casino.inventory.some((i) => i.id === tradePicked[k] && !i.locked)) tradePicked.splice(k, 1);
  }
  const picked = tradePicked.map((id) => casino.inventory.find((i) => i.id === id));
  const first = picked[0];
  const rarity = first && rarityOf(first);
  const next = rarity && rules.next[rarity];
  const pool = casino.inventory
    .filter((i) => !i.locked && !tradePicked.includes(i.id) && rules.next[rarityOf(i)] && (!first || (rarityOf(i) === rarity && !!i.stattrak === !!first.stattrak)))
    // Commonest first: that's what most trade ups use.
    .sort((a, b) => RARITY_ORDER.indexOf(rarityOf(b)) - RARITY_ORDER.indexOf(rarityOf(a)) || a.value - b.value);
  const lockedCount = casino.inventory.filter((i) => i.locked && rules.next[rarityOf(i)]).length;
  // What could come out: each skin in is an equal share, split over its case's skins of the next rarity.
  const odds = new Map();
  for (const item of picked) {
    const box = caseOfSkin(item.skinId);
    const out = box.skins.filter((s) => s.rarity === next);
    for (const s of out) odds.set(s.id, (odds.get(s.id) ?? 0) + 1 / picked.length / out.length);
  }
  const avg = picked.length ? picked.reduce((t, i) => t + i.float, 0) / picked.length : null;
  const outcomes = [...odds].map(([id, p]) => ({ skin: skinById(id), p })).sort((a, b) => b.p - a.p || b.skin.value - a.skin.value);
  const slots = Array.from({ length: n }, (_, k) => {
    const item = picked[k];
    if (!item) return '<div class="contract-slot empty"><span>+</span></div>';
    return `<button type="button" class="contract-slot" data-trade-remove="${item.id}" title="Take it out">${itemTile(skinById(item.skinId), floatLine(item.float), { float: item.float })}<span class="slot-x" aria-hidden="true">×</span></button>`;
  }).join('');
  $('#cases-main').innerHTML = `
    <div class="tradeup">
      ${lastTrade ? `<div class="trade-result reveal">${dropHtml(lastTrade)}<p class="small muted">From your trade up. It's in your inventory.</p></div>` : ''}
      <div class="contract">
        <div class="contract-head">
          <div>
            <h3>Trade up</h3>
            <p class="small muted">Put in ${n} skins of the same rarity and get one of the next, from the case of one of them. Its float is the average of theirs. All StatTrak™ in, StatTrak™ out.</p>
          </div>
          <div class="contract-go">
            <b>${picked.length}/${n}</b>
            <span class="small muted">${rarity ? `${RARITY[rarity].name} → <span style="color:${RARITY[next].color}">${RARITY[next].name}</span>` : 'Pick skins below'}</span>
            <button type="button" class="btn" data-tradeup ${picked.length === n ? '' : 'disabled'}>Trade up</button>
            ${picked.length ? '<button type="button" class="link-btn" data-trade-clear>Clear</button>' : ''}
          </div>
        </div>
        <div class="contract-slots">${slots}</div>
        ${avg !== null ? `<div class="contract-float"><span class="small muted">Float out</span> <b>${avg.toFixed(14)}</b> <span class="small">${wearOf(avg, casino.data.wears).name}</span>${floatBar(avg)}</div>` : ''}
        ${outcomes.length ? `<h4>What it could be</h4><div class="item-grid outcomes">${outcomes.map(({ skin, p }) => {
          const st = first.stattrak && skin.kind !== 'gloves';
          const est = Math.max(1, Math.round(skin.value * wearValueOf(avg) * (st ? stattrakValue : 1)));
          return itemTile(skin, `<span class="item-meta small"><b>${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%</b> · ${chipValue(est)}</span>`, { float: avg });
        }).join('')}</div>` : ''}
      </div>
      <h4>Your skins <span class="small muted">${first ? `${RARITY[rarity].name}${first.stattrak ? ' StatTrak™' : ''} only` : 'knives and gloves can\'t be traded up'}</span></h4>
      ${pool.length ? `<div class="item-grid inv">${pool.map((i) => `<button type="button" class="inv-item" data-trade-add="${i.id}">${itemTile(skinById(i.skinId), `${floatLine(i.float)}<span class="item-meta small">${i.stattrak ? '<span class="stattrak">ST</span> ' : ''}${chipValue(i.value)}</span>`, { float: i.float })}</button>`).join('')}</div>`
        : `<p class="muted empty-inv">${first ? 'No more skins that fit.' : 'Nothing to trade up yet. Open some cases first.'}</p>`}
      ${lockedCount ? `<p class="small muted">${lockedCount} locked ${lockedCount === 1 ? 'skin is' : 'skins are'} left out. Unlock them in your inventory to use them.</p>` : ''}
    </div>`;
}

async function doTradeUp(btn) {
  btn.disabled = true;
  try {
    const r = await api(casinoApi('/tradeup'), { method: 'POST', body: { ids: [...tradePicked] } });
    casino.inventory = casino.inventory.filter((i) => !r.gave.includes(i.id));
    casino.inventory.unshift(r.item);
    if (r.found) casino.found = r.found;
    tradePicked.length = 0;
    lastTrade = r.item;
    renderCases();
    $('#cases-main .trade-result')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (['covert', 'rare'].includes(skinById(r.item.skinId).rarity)) playSound('message');
  } catch (err) {
    btn.disabled = false;
    toast(err.message);
  }
}

// ---- upgrader

const upPicked = []; // item ids put on it
let upTarget = null; // { skinId, wear, stattrak }
let upWear = 'FT';
let upStattrak = false;
let upSpinning = false;
let upResult = null; // { won, roll, chance, item }

const targetValue = (skin, wear, stattrak) =>
  Math.max(1, Math.round(skin.value * casino.data.wears.find((w) => w.short === wear).value * (stattrak && skin.kind !== 'gloves' ? stattrakValue : 1)));
const upChance = (put, target) => Math.min(casino.data.upgrade.maxChance, (put / target) * casino.data.upgrade.edge);

/** The dial: the green part is the chance, and the needle lands where the server's roll says. */
function upDial(chance, angle = 0, result = null) {
  const r = 52;
  const len = 2 * Math.PI * r;
  return `<div class="up-dial ${result ? (result.won ? 'won' : 'lost') : ''}">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="${r}" class="dial-track"/>
      <circle cx="60" cy="60" r="${r}" class="dial-chance" stroke-dasharray="${(len * chance).toFixed(2)} ${len.toFixed(2)}" transform="rotate(-90 60 60)"/>
    </svg>
    <span class="dial-needle" id="dial-needle" style="transform:rotate(${angle}deg)"><i></i></span>
    <span class="dial-text"><b>${(chance * 100).toFixed(2)}%</b><span class="small">${result ? (result.won ? 'Upgraded!' : 'Lost') : 'chance'}</span></span>
  </div>`;
}

function renderUpgrade() {
  const rules = casino.data.upgrade;
  for (let k = upPicked.length - 1; k >= 0; k--) {
    if (!casino.inventory.some((i) => i.id === upPicked[k] && !i.locked)) upPicked.splice(k, 1);
  }
  const picked = upPicked.map((id) => casino.inventory.find((i) => i.id === id));
  const put = picked.reduce((n, i) => n + i.value, 0);
  const target = upTarget && skinById(upTarget.skinId);
  const goal = target ? targetValue(target, upTarget.wear, upTarget.stattrak) : 0;
  const chance = target && put && put < goal ? upChance(put, goal) : 0;
  const wears = casino.data.wears;
  const candidates = allSkins()
    .filter((s) => !(upStattrak && s.kind === 'gloves'))
    .map((s) => ({ s, v: targetValue(s, upWear, upStattrak) }))
    .filter(({ v }) => v > put)
    .sort((a, b) => a.v - b.v)
    .slice(0, 48);
  const mine = casino.inventory.filter((i) => !i.locked).sort((a, b) => b.value - a.value);
  const targetTile = target
    ? `<div class="up-target">${itemTile(target, `<span class="item-meta small">${upTarget.stattrak ? '<span class="stattrak">ST</span> ' : ''}${wears.find((w) => w.short === upTarget.wear).name} · ${chipValue(goal)}</span>`, { float: (wears.find((w) => w.short === upTarget.wear).min + wears.find((w) => w.short === upTarget.wear).max) / 2 })}</div>`
    : '<div class="up-empty">Pick a skin to go for</div>';
  const angle = upResult ? 360 * 5 + upResult.roll * 360 : 0;
  $('#cases-main').innerHTML = `
    <div class="upgrader">
      <div class="up-stage">
        <div class="up-side">
          <span class="small muted">You put in</span>
          ${picked.length ? `<div class="up-mini">${picked.map((i) => `<button type="button" class="up-chip r-${rarityOf(i)}" style="--rarity:${RARITY[rarityOf(i)].color}" data-up-remove="${i.id}" title="Take it off">${skinArt(skinById(i.skinId), i.float)}</button>`).join('')}</div>` : '<div class="up-empty">Pick up to ' + rules.maxItems + ' skins below</div>'}
          <b>${chipValue(put)}</b>
        </div>
        ${upDial(upResult ? upResult.chance : chance, angle, null)}
        <div class="up-side">
          <span class="small muted">You go for</span>
          ${targetTile}
          <b>${goal ? chipValue(goal) : ''}${goal && put ? ` <span class="small muted">×${(goal / put).toFixed(2)}</span>` : ''}</b>
        </div>
      </div>
      <div class="up-go">
        <button type="button" class="btn" data-upgrade ${chance > 0 && !upSpinning ? '' : 'disabled'}>Upgrade</button>
        <p class="small muted" id="up-message">${upResult ? (upResult.won ? 'It worked! The new skin is in your inventory.' : 'Not this time. Those skins are gone.')
          : target && put >= goal ? 'Go for something worth more than what you put in.' : 'Your skins are used up either way. The chance is what they\'re worth over what you go for, a little under, up to ' + Math.round(rules.maxChance * 100) + '%.'}</p>
      </div>
      <div class="up-pickers">
        <section>
          <h4>Your skins <span class="small muted">${upPicked.length}/${rules.maxItems}</span></h4>
          ${mine.length ? `<div class="item-grid inv up-grid">${mine.map((i) => {
            const on = upPicked.includes(i.id);
            return `<button type="button" class="inv-item ${on ? 'picked' : ''}" data-up-add="${i.id}" aria-pressed="${on}">${itemTile(skinById(i.skinId), `${floatLine(i.float)}<span class="item-meta small">${i.stattrak ? '<span class="stattrak">ST</span> ' : ''}${chipValue(i.value)}</span>`, { float: i.float })}<span class="pick-mark" aria-hidden="true"></span></button>`;
          }).join('')}</div>` : '<p class="muted empty-inv">No unlocked skins to put in.</p>'}
        </section>
        <section>
          <h4>Go for</h4>
          <div class="inv-filters">
            <select data-up-wear aria-label="Wear">${wears.map((w) => `<option value="${w.short}" ${w.short === upWear ? 'selected' : ''}>${w.name}</option>`).join('')}</select>
            <label class="inv-st"><input type="checkbox" data-up-st ${upStattrak ? 'checked' : ''}> StatTrak™</label>
          </div>
          ${candidates.length ? `<div class="item-grid up-grid">${candidates.map(({ s, v }) => {
            const on = upTarget?.skinId === s.id && upTarget.wear === upWear && upTarget.stattrak === upStattrak;
            const w = wears.find((x) => x.short === upWear);
            return `<button type="button" class="inv-item ${on ? 'picked' : ''}" data-up-target="${s.id}" aria-pressed="${on}">${itemTile(s, `<span class="item-meta small">${chipValue(v)}${put ? ` · <b>${(upChance(put, v) * 100).toFixed(1)}%</b>` : ''}</span>`, { float: (w.min + w.max) / 2 })}<span class="pick-mark" aria-hidden="true"></span></button>`;
          }).join('')}</div>` : '<p class="muted empty-inv">Nothing is worth more than that.</p>'}
        </section>
      </div>
    </div>`;
}

async function doUpgrade(btn) {
  if (upSpinning || !upTarget) return;
  upSpinning = true;
  btn.disabled = true;
  let r;
  try {
    r = await api(casinoApi('/upgrade'), { method: 'POST', body: { ids: [...upPicked], ...upTarget } });
  } catch (err) {
    upSpinning = false;
    btn.disabled = false;
    return toast(err.message);
  }
  // Spin the needle a few times round, landing on the roll (in view: on a phone the pickers are below it).
  const needle = $('#dial-needle');
  needle?.closest('.up-dial').scrollIntoView({ block: 'center', behavior: 'smooth' });
  const ms = 4200;
  if (needle) {
    needle.style.transition = 'none';
    needle.style.transform = 'rotate(0deg)';
    needle.getBoundingClientRect();
    needle.style.transition = `transform ${ms}ms cubic-bezier(.12,.7,.14,1)`;
    needle.style.transform = `rotate(${360 * 5 + r.roll * 360}deg)`;
  }
  await new Promise((done) => setTimeout(done, needle ? ms + 150 : 0));
  upSpinning = false;
  casino.inventory = casino.inventory.filter((i) => !r.gave.includes(i.id));
  if (r.item) casino.inventory.unshift(r.item);
  if (r.found) casino.found = r.found;
  upPicked.length = 0;
  upResult = r;
  if (caseView !== 'upgrade') return;
  renderCases();
  $('#cases-main .up-dial')?.classList.add(r.won ? 'won' : 'lost');
  if (r.won) {
    playSound('message');
    const skin = skinById(r.item.skinId);
    $('#up-message').innerHTML = `It worked! ${escapeHtml(skinTitle(skin, r.item.stattrak))} is in your inventory. <button type="button" class="link-btn" data-up-brag>Show the fire</button>`;
  }
}

/** Clicks in the Trade up and Upgrade views. Says whether it handled the click. */
function onTradeClick(t) {
  const add = t.closest('[data-trade-add]');
  if (add) {
    if (tradePicked.length < casino.data.tradeUp.count) tradePicked.push(Number(add.dataset.tradeAdd));
    lastTrade = null;
    renderTradeUp();
    return true;
  }
  const remove = t.closest('[data-trade-remove]');
  if (remove) {
    tradePicked.splice(tradePicked.indexOf(Number(remove.dataset.tradeRemove)), 1);
    renderTradeUp();
    return true;
  }
  if (t.closest('[data-trade-clear]')) { tradePicked.length = 0; renderTradeUp(); return true; }
  const go = t.closest('[data-tradeup]');
  if (go) { doTradeUp(go); return true; }
  if (upSpinning) return !!t.closest('[data-up-add], [data-up-remove], [data-up-target], [data-upgrade]');
  const upAdd = t.closest('[data-up-add], [data-up-remove]');
  if (upAdd) {
    const id = Number(upAdd.dataset.upAdd ?? upAdd.dataset.upRemove);
    const k = upPicked.indexOf(id);
    if (k >= 0) upPicked.splice(k, 1);
    else if (upPicked.length < casino.data.upgrade.maxItems) upPicked.push(id);
    else toast(`At most ${casino.data.upgrade.maxItems} skins at once.`);
    upResult = null;
    renderUpgrade();
    return true;
  }
  const target = t.closest('[data-up-target]');
  if (target) {
    upTarget = { skinId: target.dataset.upTarget, wear: upWear, stattrak: upStattrak };
    upResult = null;
    renderUpgrade();
    return true;
  }
  const up = t.closest('[data-upgrade]');
  if (up) { doUpgrade(up); return true; }
  if (t.closest('[data-up-brag]') && upResult?.item) {
    const { title, wear } = itemDetails(upResult.item);
    brag(`🎯 Upgraded to ${title} (${wear.name}) at ${(upResult.chance * 100).toFixed(2)}%`);
    return true;
  }
  return false;
}

document.addEventListener('change', (e) => {
  if (!e.target.closest?.('#casino')) return;
  if (e.target.matches('[data-up-wear]')) { upWear = e.target.value; renderUpgrade(); }
  if (e.target.matches('[data-up-st]')) { upStattrak = e.target.checked; renderUpgrade(); }
});

// ---- premium pets

function buildPets() {
  casinoPanes.pets.innerHTML = '<div class="pets" id="pets-main"></div>';
  casinoPanes.pets.addEventListener('click', onPetsClick);
}

function renderPets() {
  const main = $('#pets-main');
  if (!main || !casino.data) return;
  const chips = casino.wallet?.chips ?? 0;
  main.innerHTML = `
    <div class="pets-head">
      <h3>Pets</h3>
      <p class="small muted">A premium pet sits by your seat at this hearth's fires, in place of what you picked in your fire settings, and everyone here sees it. Bought with this hearth's chips, and it stays in this hearth.</p>
    </div>
    <div class="pet-grid">${(casino.data.pets ?? []).map((p) => {
      const owned = casino.myPets.includes(p.id);
      const out = casino.pet === p.id;
      return `<div class="pet-card ${owned ? 'owned' : ''} ${out ? 'out' : ''}">
        <div class="pet-art">${pixelSvg(p.id)}</div>
        <b>${escapeHtml(p.name.replace(/^An? /, ''))}</b>
        ${owned
          ? out ? '<span class="pet-badge">By your seat</span><button type="button" class="btn secondary" data-pet-wear="">Put away</button>'
            : `<button type="button" class="btn" data-pet-wear="${p.id}">Bring to the fire</button>`
          : `<button type="button" class="btn" data-pet-buy="${p.id}" ${chips < p.price ? 'disabled' : ''}>${chipValue(p.price)}</button>`}
      </div>`;
    }).join('')}</div>`;
}

async function onPetsClick(e) {
  const buy = e.target.closest('[data-pet-buy]');
  if (buy) {
    const pet = casino.data.pets.find((p) => p.id === buy.dataset.petBuy);
    if (!confirm(`Buy ${pet.name.toLowerCase()} for ${chipsText(pet.price)} chips? It stays in this hearth.`)) return;
    try {
      const r = await api(casinoApi(`/pets/${pet.id}`), { method: 'POST', body: {} });
      Object.assign(casino, { myPets: r.myPets, pet: r.pet });
      setWallet(r.wallet);
      renderPets();
      toast(`${pet.name} is by your seat now.`);
    } catch (err) { toast(err.message); }
    return;
  }
  const wear = e.target.closest('[data-pet-wear]');
  if (wear) {
    try {
      const r = await api(casinoApi('/pet'), { method: 'PUT', body: { pet: wear.dataset.petWear || null } });
      Object.assign(casino, { myPets: r.myPets, pet: r.pet });
      renderPets();
    } catch (err) { toast(err.message); }
  }
}

/** Someone in a hearth got out a pet (or put it away): it shows by their seat. */
function onCasinoPet(ev) {
  const m = state.servers.get(ev.serverId)?.members?.find((x) => x.id === ev.userId);
  if (m) m.pet = ev.pet;
  if (ev.userId === state.me.id && ev.serverId === casino.hearthId) {
    casino.pet = ev.pet;
    renderPets();
  }
  if (state.voice) renderFire();
}
