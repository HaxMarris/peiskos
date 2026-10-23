// The casino, in the games at the fire: Texas hold 'em, blackjack, a slot machine and cases to open.
// Chips are play money only, and each hearth is its own casino: its own chips and skins. The
// server deals, spins and opens everything; this only shows it.
//
// It opens on the fire's stage, like a game. Each fire has its own hold 'em table, for the people
// sitting at it; blackjack, the slots and cases are just you.

const casino = {
  data: null, // the lobby: cases, slot reels, the rules
  loading: null,
  wallet: null,
  channelId: null, // the fire whose casino is open
  tab: store.get('casinoTab') || 'poker',
  table: null, // the hold 'em table at your fire
  tableRoom: null,
  blackjack: null,
  inventory: [],
  found: [],
  hearthId: null, // whose casino is open: chips and skins belong to a hearth
};
const CASINO_TABS = [
  ['poker', "Hold 'em"],
  ['blackjack', 'Blackjack'],
  ['slots', 'Slots'],
  ['cases', 'Cases'],
  ['battles', 'Battles'],
];
/** The casino of the hearth whose fire you're at: its own chips, skins and book. */
const casinoApi = (path = '') => `/api/servers/${casino.hearthId}/casino${path}`;
const chipsText = (n) => Number(n ?? 0).toLocaleString();
const casinoPanes = {};
let casinoBuilt = false;

// ---- opening and closing it on the fire's stage

const casinoOnScreen = () => casino.channelId !== null && state.stageOpen && state.stageShow === 'casino';

/** Opens the casino on the stage, on one of its games. */
function openCasino(tab = casino.tab) {
  if (!state.voice) return;
  if (!CASINO_TABS.some(([id]) => id === tab)) tab = 'poker';
  casino.tab = tab;
  store.set('casinoTab', tab);
  const channelId = state.voice.channelId;
  if (casino.tableRoom !== channelId) casino.table = null;
  casino.channelId = channelId;
  // Chips and skins belong to the hearth, so a fire in another hearth means another casino.
  const hearth = roomById(channelId)?.s.id ?? null;
  if (casino.hearthId !== hearth) {
    casino.hearthId = hearth;
    casino.data = null;
    casino.wallet = null;
    casino.inventory = [];
    casino.found = [];
    casino.blackjack = null;
    casino.loading = null;
    topPulls = null;
  }
  buildCasino();
  sendCasino(channelId);
  loadCasino();
  if (!state.stageOpen) openStage();
  state.stageShow = 'casino';
  renderStage();
  renderCasino();
}

/** Back to the fire; the table keeps going without you watching (you stay seated if you sat down). */
function closeCasino() {
  if (state.stageShow === 'casino') {
    state.stageShow = 'fire';
    renderStage();
  }
}

/** Leaving the fire leaves its table too (the server stands you up). */
function stopCasino() {
  closeCasino();
  if (casino.channelId !== null) sendCasino(null);
  casino.channelId = null;
  casino.table = null;
  casino.tableRoom = null;
  battles.list = [];
  battles.watching = null;
  stopBattle();
}

const sendCasino = (channelId) => state.ws?.readyState === WebSocket.OPEN && state.ws.send(JSON.stringify({ type: 'casino', channelId }));
/** Back online: the server forgot which table we're looking at. */
function casinoReconnected() {
  if (casino.channelId !== null && state.voice?.channelId === casino.channelId) sendCasino(casino.channelId);
  if (casino.data) loadCasino(true);
}

async function loadCasino(fresh = false) {
  if (casino.data && !fresh) return casino.data;
  const hearth = casino.hearthId;
  if (casino.loading) return casino.loading;
  const loading = (casino.loading = api(casinoApi())
    .then((d) => {
      if (hearth !== casino.hearthId) return d;
      casino.data = d;
      casino.wallet = d.wallet;
      casino.blackjack = d.blackjack;
      casino.inventory = d.inventory;
      casino.found = d.found ?? [];
      renderCasino();
      return d;
    })
    .finally(() => {
      if (casino.loading === loading) casino.loading = null;
    }));
  return loading;
}

$('#casino-back').onclick = closeCasino;

function buildCasino() {
  if (casinoBuilt) return;
  casinoBuilt = true;
  const root = $('#casino');
  root.innerHTML = `
    <div class="casino-top">
      <div class="chip-balance" title="Your chips">
        <span class="chip-icon" aria-hidden="true"></span>
        <span class="chip-text"><b id="casino-chips">…</b><span class="small muted" id="casino-at-table"></span></span>
      </div>
      <button type="button" class="btn secondary" id="casino-free">Free chips</button>
      <span class="casino-spacer"></span>
      <button type="button" class="icon-btn" id="casino-leaders" title="Richest in this hearth" aria-label="Richest in this hearth">
        <svg viewBox="0 0 24 24"><path d="M7 3h10v2h3v3a5 5 0 0 1-4.3 5A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 13 5 5 0 0 1 4 8V5h3V3Zm0 4H6v1a3 3 0 0 0 1.2 2.4A5 5 0 0 1 7 9V7Zm10 0v2c0 .5 0 1-.2 1.4A3 3 0 0 0 18 8V7h-1Z"/></svg>
      </button>
    </div>
    <div class="casino-tabs" role="tablist">${CASINO_TABS.map(([id, label]) => `<button type="button" role="tab" data-tab="${id}">${label}</button>`).join('')}</div>
    <div class="casino-body">
      ${CASINO_TABS.map(([id]) => `<section class="casino-pane" data-pane="${id}" role="tabpanel"></section>`).join('')}
    </div>
    <p class="casino-note small muted">Play chips only: they can't be bought, sold or cashed out.</p>`;
  root.querySelectorAll('.casino-pane').forEach((p) => (casinoPanes[p.dataset.pane] = p));
  root.querySelector('.casino-tabs').onclick = (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    casino.tab = b.dataset.tab;
    store.set('casinoTab', casino.tab);
    renderCasino();
  };
  $('#casino-free').onclick = claimFreeChips;
  $('#casino-leaders').onclick = openLeaders;
  buildPoker();
  buildBlackjack();
  buildSlots();
  buildCases();
  buildBattles();
}

function renderCasino() {
  if (!casinoBuilt) return;
  for (const b of $('#casino').querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === casino.tab));
  for (const [id, pane] of Object.entries(casinoPanes)) pane.classList.toggle('hidden', id !== casino.tab);
  renderWallet();
  if (!casino.data) return;
  renderPoker();
  renderBlackjack();
  renderSlotControls();
  renderCases();
  renderBattles();
}

// ---- chips

function renderWallet() {
  if (!casinoBuilt) return;
  const w = casino.wallet;
  $('#casino-chips').textContent = w ? chipsText(w.chips) : '…';
  const credits = $('#slot-credits');
  if (credits) credits.textContent = w ? chipsText(w.chips) : '0';
  $('#casino-at-table').textContent = [w?.atTable && `+${chipsText(w.atTable)} at the table`, w?.inBattle && `+${chipsText(w.inBattle)} in a battle`].filter(Boolean).join(' · ');
  const free = $('#casino-free');
  const ready = !!w && !w.freeAt;
  free.disabled = !ready;
  free.classList.toggle('ready', ready);
  free.textContent = !w ? 'Free chips' : ready ? `Free ${chipsText(w.freeAmount)}${isPhone() ? '' : ' chips'}` : `More ${untilText(w.freeAt)}`;
}
const untilText = (at) => {
  const mins = Math.max(1, Math.ceil((at - Date.now()) / 60000));
  return mins < 60 ? `in ${mins} min` : `in ${Math.floor(mins / 60)} h ${mins % 60 ? `${mins % 60} min` : ''}`.trim();
};
setInterval(() => { if (casino.channelId !== null) renderWallet(); }, 30_000);

function setWallet(w, serverId = casino.hearthId) {
  if (!w || serverId !== casino.hearthId) return;
  casino.wallet = w;
  renderWallet();
}

async function claimFreeChips() {
  try {
    const r = await api(casinoApi('/free'), { method: 'POST', body: {} });
    setWallet(r.wallet);
    toast(`+${chipsText(r.got)} chips. Have fun!`);
  } catch (err) { toast(err.message); }
}

async function openLeaders(board = 'chips') {
  const s = roomById(casino.channelId)?.s;
  if (!s) return;
  const floats = board === 'floats';
  modal(`<h2>${floats ? 'Lowest floats' : 'Richest'} in ${escapeHtml(s.name)}</h2>
    <div class="leader-tabs" role="tablist">
      <button type="button" role="tab" data-board="chips" aria-selected="${!floats}">Richest</button>
      <button type="button" role="tab" data-board="floats" aria-selected="${floats}">Lowest floats</button>
    </div>
    <p class="small muted">${floats ? 'The cleanest skins anyone here has unboxed. Lower is better.' : "Chips, plus what's in their inventory."}</p>
    <ol class="leaders${floats ? ' float-leaders' : ''}" id="leaders"><li class="muted">Counting…</li></ol>
    <div class="modal-row"><button type="button" class="btn" data-close>Close</button></div>`);
  document.querySelectorAll('.leader-tabs [data-board]').forEach((b) => b.addEventListener('click', () => b.dataset.board !== board && openLeaders(b.dataset.board)));
  const who = (userId) => {
    const av = document.createElement('span');
    av.className = 'avatar xs';
    setAvatar(av, nameOf(userId, 'Someone'), avatarOf(userId));
    return av;
  };
  try {
    const rows = await api(`/api/servers/${s.id}/casino/${floats ? 'floats' : 'leaders'}`);
    const list = $('#leaders');
    if (!list) return;
    list.replaceChildren(...rows.map((r, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="leader-rank">${i + 1}</span>`;
      if (floats) {
        const skin = skinById(r.skinId);
        const wear = wearOf(r.float, casino.data.wears);
        const item = document.createElement('span');
        item.className = 'leader-skin';
        item.innerHTML = skin
          ? `<span class="leader-art r-${skin.rarity}" style="--rarity:${RARITY[skin.rarity].color}">${skinArt(skin, r.float)}</span>
            <span class="leader-name"><b>${skin.rarity === 'rare' ? '★ ' : ''}${escapeHtml(skin.name)}</b><span class="small muted">${escapeHtml(skin.weapon)} · ${wear.name}</span></span>`
          : '<span class="leader-name muted">A retired skin</span>';
        const f = document.createElement('span');
        f.className = 'leader-float';
        f.innerHTML = `<b>${r.float.toFixed(14)}</b><span class="small muted">${escapeHtml(nameOf(r.userId, 'Someone'))}</span>`;
        f.prepend(who(r.userId));
        li.append(item, f);
        return li;
      }
      const name = document.createElement('span');
      name.className = 'leader-name';
      name.textContent = nameOf(r.userId, 'Someone');
      const n = document.createElement('span');
      n.className = 'leader-chips';
      n.innerHTML = `<b>${chipsText(r.chips + r.items)}</b>${r.items ? `<span class="small muted">${chipsText(r.items)} in items</span>` : ''}`;
      li.append(who(r.userId), name, n);
      return li;
    }));
    if (!rows.length) list.innerHTML = `<li class="muted">${floats ? 'Nobody has opened a case yet.' : 'Nobody has played yet.'}</li>`;
  } catch (err) { $('#leaders') && ($('#leaders').innerHTML = `<li class="error">${escapeHtml(err.message)}</li>`); }
}

/** Posts a line in the fireside chat, to show off. */
function brag(text) {
  if (!state.voice || state.ws?.readyState !== WebSocket.OPEN) return toast("You're offline right now.");
  state.ws.send(JSON.stringify({ type: 'fireside_send', content: text }));
  toast('Shared in the fireside chat.');
}

// ---- Texas hold 'em

function buildPoker() {
  const pane = casinoPanes.poker;
  pane.innerHTML = `
    <div class="poker">
      <div class="poker-stage">
        <div class="poker-table" id="poker-table">
          <div class="poker-felt">
            <div class="poker-pot" id="poker-pot"></div>
            <div class="poker-board" id="poker-board"></div>
            <div class="poker-brand"><span class="logo-mark" aria-hidden="true"></span>Peiskos hold 'em</div>
          </div>
          <div id="poker-seats"></div>
        </div>
      </div>
      <div class="poker-bar" id="poker-bar"></div>
      <ol class="poker-log small muted" id="poker-log" aria-live="polite"></ol>
    </div>`;
  pane.addEventListener('click', onPokerClick);
  pane.addEventListener('input', (e) => {
    if (e.target.id === 'poker-raise') $('#poker-raise-to').textContent = chipsText(e.target.value);
  });
}

const myPokerSeat = () => casino.table?.seats.findIndex((s) => s?.userId === state.me.id) ?? -1;

function onCasinoPoker(ev) {
  if (ev.channelId !== state.voice?.channelId) return;
  const before = casino.table;
  casino.table = ev.table;
  casino.tableRoom = ev.channelId;
  // Your turn while you're looking at something else.
  const me = ev.table.seats.findIndex((s) => s?.userId === state.me.id);
  const yourTurn = me >= 0 && ev.table.toAct === me;
  const wasYourTurn = before && before.toAct === me && before.handNo === ev.table.handNo;
  if (yourTurn && !wasYourTurn) {
    if (!casinoOnScreen() || casino.tab !== 'poker' || document.hidden)
      toast("It's your turn at the poker table.", { action: 'Go', onAction: goToPoker });
    playSound('message');
  }
  if (ev.channelId === casino.channelId) renderPoker(before);
}

function goToPoker() {
  if (!state.voice) return;
  goToVoice();
  openCasino('poker');
}

/** Seats go round the table with yours at the bottom. */
function seatSpot(i, mine, count) {
  const p = mine >= 0 ? (i - mine + count) % count : i;
  const angle = Math.PI / 2 + (p * 2 * Math.PI) / count;
  return { x: 50 + 48 * Math.cos(angle), y: 50 + 50 * Math.sin(angle) };
}

function renderPoker(before = null) {
  const t = casino.table;
  if (!casinoBuilt || !t) {
    if (casinoBuilt && !t) {
      $('#poker-seats').replaceChildren();
      $('#poker-bar').innerHTML = '<p class="muted">Getting the table…</p>';
    }
    return;
  }
  const mine = myPokerSeat();
  const count = t.seats.length;
  $('#poker-board').innerHTML = [0, 1, 2, 3, 4].map((k) =>
    t.board[k] ? cardHtml(t.board[k], (before?.board.length ?? 0) <= k || before?.handNo !== t.handNo ? 'deal' : '') : '<span class="pcard slot"></span>').join('');
  $('#poker-pot').innerHTML = t.handNo
    ? `<span class="chip-icon sm" aria-hidden="true"></span>Pot ${chipsText(t.pot + t.seats.reduce((n, s) => n + (s?.bet ?? 0), 0))}`
    : `<span class="small">Blinds ${t.smallBlind}/${t.bigBlind}</span>`;
  const seats = t.seats.map((s, i) => {
    const spot = seatSpot(i, mine, count);
    const el = document.createElement('div');
    el.className = 'p-seat';
    el.style.left = `${spot.x}%`;
    el.style.top = `${spot.y}%`;
    // Bets sit between the seat and the middle of the table.
    el.style.setProperty('--to-x', `${(50 - spot.x) * 0.3}cqw`);
    el.style.setProperty('--to-y', `${(50 - spot.y) * 0.3}cqh`);
    if (!s) {
      el.classList.add('empty');
      el.innerHTML = mine < 0 ? `<button type="button" class="p-sit" data-sit="${i}">Sit</button>` : '<span class="p-open" aria-hidden="true"></span>';
      return el;
    }
    const name = s.userId === state.me.id ? 'You' : nameOf(s.userId, 'Player');
    el.classList.toggle('me', s.userId === state.me.id);
    el.classList.toggle('acting', t.toAct === i);
    el.classList.toggle('folded', s.folded);
    el.classList.toggle('out', s.sittingOut || !s.online);
    el.classList.toggle('won', t.winners.includes(i));
    const newHand = before?.handNo !== t.handNo;
    el.innerHTML = `
      <div class="p-cards">${s.cards.map((c) => cardHtml(c, newHand ? 'deal' : '')).join('')}</div>
      <div class="p-plate">
        <span class="avatar sm p-avatar"></span>
        <span class="p-info"><b class="p-name"></b><span class="p-stack">${s.allIn ? 'All in' : chipsText(s.stack)}</span></span>
        ${t.button === i ? '<span class="p-button" title="Dealer">D</span>' : ''}
      </div>
      <div class="p-status">${t.winners.includes(i) && s.won ? `<span class="p-won">+${chipsText(s.won)}</span>` : ''}${s.handName ? `<span class="p-hand">${escapeHtml(s.handName)}</span>` : s.lastAction ? `<span class="p-action">${escapeHtml(s.lastAction)}</span>` : s.sittingOut ? '<span class="p-action">Sitting out</span>' : !s.online ? '<span class="p-action">Away</span>' : ''}</div>
      ${s.bet ? `<div class="p-bet"><span class="chip-icon sm" aria-hidden="true"></span>${chipsText(s.bet)}</div>` : ''}`;
    el.querySelector('.p-name').textContent = name;
    setAvatar(el.querySelector('.p-avatar'), nameOf(s.userId, 'Player'), avatarOf(s.userId));
    if (t.toAct === i && t.deadline) el.querySelector('.p-plate').append(timerRing(t.deadline));
    return el;
  });
  $('#poker-seats').replaceChildren(...seats);
  $('#poker-log').replaceChildren(...t.log.slice(-4).reverse().map((line) => {
    const li = document.createElement('li');
    li.textContent = line.replace(/@(\d+)/g, (_, id) => (Number(id) === state.me.id ? 'You' : nameOf(Number(id), 'Someone')));
    return li;
  }));
  renderPokerBar();
}

/** A ring that runs down while someone has to act. */
function timerRing(deadline) {
  const ring = document.createElement('span');
  ring.className = 'p-timer';
  const total = Math.max(1, deadline - Date.now());
  const tick = () => {
    if (!ring.isConnected) return;
    const left = Math.max(0, deadline - Date.now());
    ring.style.setProperty('--left', String(left / Math.max(total, 30000)));
    if (left > 0) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return ring;
}

function renderPokerBar() {
  const t = casino.table;
  const bar = $('#poker-bar');
  const mine = myPokerSeat();
  const rules = casino.data?.poker ?? { minBuyIn: 400, maxBuyIn: 4000 };
  if (mine < 0) {
    bar.innerHTML = `<p class="poker-hint">Pick a seat to play. Blinds ${t.smallBlind}/${t.bigBlind}, buy in for ${chipsText(rules.minBuyIn)} to ${chipsText(rules.maxBuyIn)} chips.</p>`;
    return;
  }
  const me = t.seats[mine];
  const o = t.options;
  const parts = [];
  if (o) {
    const pot = t.pot + t.seats.reduce((n, s) => n + (s?.bet ?? 0), 0);
    const potTo = (share) => Math.max(o.minRaiseTo, Math.min(o.maxRaiseTo, t.currentBet + Math.round((pot + o.toCall) * share)));
    parts.push(`<div class="poker-moves">
      <button type="button" class="btn secondary" data-move="fold">Fold</button>
      ${o.canCheck ? '<button type="button" class="btn secondary" data-move="check">Check</button>' : `<button type="button" class="btn" data-move="call">Call ${chipsText(o.toCall)}</button>`}
      ${o.canRaise ? `<button type="button" class="btn" data-move="raise">${t.currentBet ? 'Raise to' : 'Bet'} <span id="poker-raise-to">${chipsText(o.minRaiseTo)}</span></button>` : ''}
    </div>`);
    if (o.canRaise)
      parts.push(`<div class="poker-raise">
        <input type="range" id="poker-raise" min="${o.minRaiseTo}" max="${o.maxRaiseTo}" step="${Math.max(1, Math.round(t.bigBlind / 2))}" value="${o.minRaiseTo}" aria-label="How much to raise to" />
        <button type="button" class="link-btn" data-to="${potTo(0.5)}">½ pot</button>
        <button type="button" class="link-btn" data-to="${potTo(1)}">Pot</button>
        <button type="button" class="link-btn" data-to="${o.maxRaiseTo}">All in</button>
      </div>`);
  } else if (t.toAct >= 0 && me.inHand && !me.folded) {
    parts.push(`<p class="poker-hint">Waiting for ${escapeHtml(nameOf(t.seats[t.toAct]?.userId, 'someone'))}…</p>`);
  } else if (t.done && t.seats.filter((s) => s && s.stack > 0 && !s.sittingOut).length < 2) {
    parts.push('<p class="poker-hint">Waiting for someone else to sit down.</p>');
  }
  parts.push(`<div class="poker-seat-moves">
    ${me.sittingOut ? '<button type="button" class="btn" data-move="back">I\'m back</button>' : '<button type="button" class="link-btn" data-move="sitout">Sit out next hand</button>'}
    ${me.stack < rules.maxBuyIn ? '<button type="button" class="link-btn" data-move="add">Add chips</button>' : ''}
    <button type="button" class="link-btn" data-move="stand">${me.leaving ? 'Leaving after this hand' : 'Stand up'}</button>
  </div>`);
  bar.innerHTML = parts.join('');
}

async function pokerMove(body) {
  try {
    await api(`/api/channels/${casino.channelId}/poker`, { method: 'POST', body });
  } catch (err) { toast(err.message); }
}

function onPokerClick(e) {
  const sit = e.target.closest('[data-sit]');
  if (sit) return openBuyIn(Number(sit.dataset.sit));
  const to = e.target.closest('[data-to]');
  if (to) {
    const range = $('#poker-raise');
    range.value = to.dataset.to;
    $('#poker-raise-to').textContent = chipsText(range.value);
    return;
  }
  const b = e.target.closest('[data-move]');
  if (!b) return;
  const move = b.dataset.move;
  if (move === 'raise') {
    const value = Number($('#poker-raise')?.value);
    return pokerMove({ action: value >= casino.table.options.maxRaiseTo ? 'allin' : 'raise', to: value });
  }
  if (move === 'add') return openBuyIn(myPokerSeat(), true);
  if (move === 'stand' && casino.table.seats[myPokerSeat()]?.leaving) return;
  pokerMove({ action: move });
}

function openBuyIn(seat, adding = false) {
  const rules = casino.data.poker;
  const have = casino.wallet?.chips ?? 0;
  const atTable = adding ? casino.table.seats[seat]?.stack ?? 0 : 0;
  const max = Math.min(rules.maxBuyIn - atTable, have);
  const min = adding ? 1 : rules.minBuyIn;
  if (max < min) return toast(adding ? "You can't add more chips right now." : `You need at least ${chipsText(rules.minBuyIn)} chips to sit down.`);
  const start = Math.min(max, adding ? max : Math.max(min, Math.min(2000, max)));
  modal(`<h2>${adding ? 'Add chips' : 'Sit down'}</h2>
    <form id="buyin-form">
      <p class="small muted">${adding ? `You have ${chipsText(atTable)} at the table and can have up to ${chipsText(rules.maxBuyIn)}.` : `Blinds are ${rules.smallBlind}/${rules.bigBlind}. What's left goes back to your chips when you stand up.`}</p>
      <label>Chips<input type="range" id="buyin" min="${min}" max="${max}" step="${adding ? 1 : 20}" value="${start}" /></label>
      <p class="buyin-amount"><span class="chip-icon" aria-hidden="true"></span><b id="buyin-n">${chipsText(start)}</b></p>
      <div class="error" id="modal-error"></div>
      <div class="modal-row"><button type="button" class="btn secondary" data-close>Cancel</button><button type="submit" class="btn">${adding ? 'Add' : 'Sit down'}</button></div>
    </form>`);
  $('#buyin').oninput = () => ($('#buyin-n').textContent = chipsText($('#buyin').value));
  $('#buyin-form').onsubmit = async (e) => {
    e.preventDefault();
    const chips = Number($('#buyin').value);
    try {
      await api(`/api/channels/${casino.channelId}/poker`, { method: 'POST', body: adding ? { action: 'add', chips } : { action: 'sit', seat, buyIn: chips } });
      closeModal();
    } catch (err) { $('#modal-error').textContent = err.message; }
  };
}

// ---- blackjack

let bjBet = Number(store.get('bjBet')) || 100;

function buildBlackjack() {
  casinoPanes.blackjack.innerHTML = `
    <div class="bj">
      <div class="bj-table">
        <div class="bj-side"><span class="bj-label">Dealer <b id="bj-dealer-total"></b></span><div class="bj-cards" id="bj-dealer"></div></div>
        <div class="bj-rules small">Blackjack pays 3 to 2 · Dealer stands on soft 17</div>
        <div class="bj-msg" id="bj-msg" aria-live="polite"></div>
        <div class="bj-hands" id="bj-hands"></div>
      </div>
      <div class="bj-controls" id="bj-controls"></div>
    </div>`;
  casinoPanes.blackjack.addEventListener('click', onBlackjackClick);
}

function renderBlackjack(before = null) {
  const g = casino.blackjack;
  $('#bj-dealer').innerHTML = (g?.dealer ?? []).map((c, k) => cardHtml(c, isNewCard(before?.dealer, g.dealer, k) ? 'deal' : '')).join('');
  $('#bj-dealer-total').textContent = g ? (g.over ? String(g.dealerTotal) : `${g.dealerTotal}+`) : '';
  $('#bj-hands').replaceChildren(...(g?.hands ?? []).map((h, i) => {
    const el = document.createElement('div');
    el.className = 'bj-hand' + (!g.over && i === g.active && g.hands.length > 1 ? ' active' : '') + (h.result ? ` ${h.result}` : '');
    const total = h.soft && h.total < 21 && !h.done ? `${h.total - 10} / ${h.total}` : String(h.total);
    el.innerHTML = `<div class="bj-cards">${h.cards.map((c, k) => cardHtml(c, isNewCard(before?.hands[i]?.cards, h.cards, k) ? 'deal' : '')).join('')}</div>
      <div class="bj-hand-info"><b>${total}</b><span><span class="chip-icon sm" aria-hidden="true"></span>${chipsText(h.bet)}</span>${h.result ? `<span class="bj-result">${resultText(h)}</span>` : ''}</div>`;
    return el;
  }));
  const msg = $('#bj-msg');
  if (!g) msg.textContent = 'Place a bet to start.';
  else if (!g.over) msg.textContent = g.hands.length > 1 ? `Playing hand ${g.active + 1} of ${g.hands.length}` : '';
  else {
    const paid = g.hands.reduce((n, h) => n + h.paid, 0);
    const bet = g.hands.reduce((n, h) => n + h.bet, 0);
    const bust = g.hands.every((h) => h.result === 'bust');
    msg.textContent = paid > bet ? `You win ${chipsText(paid - bet)}!` : paid === bet ? 'Push: your bet comes back.' : bust ? 'Bust!' : 'Dealer wins.';
    msg.className = 'bj-msg ' + (paid > bet ? 'good' : paid === bet ? '' : 'bad');
  }
  if (!g?.over) msg.className = 'bj-msg';
  renderBlackjackControls();
}
const isNewCard = (old, now, k) => !old || k >= old.length || old[k] !== now[k];
const resultText = (h) => ({ blackjack: `Blackjack! +${chipsText(h.paid - h.bet)}`, win: `Win +${chipsText(h.paid - h.bet)}`, push: 'Push', lose: 'Lose', bust: 'Bust' })[h.result] ?? '';

function renderBlackjackControls() {
  const g = casino.blackjack;
  const box = $('#bj-controls');
  if (g && !g.over) {
    box.innerHTML = `<div class="bj-moves">
      <button type="button" class="btn" data-bj="hit">Hit</button>
      <button type="button" class="btn" data-bj="stand">Stand</button>
      ${g.can?.double ? `<button type="button" class="btn secondary" data-bj="double">Double (${chipsText(g.hands[g.active].bet)})</button>` : ''}
      ${g.can?.split ? `<button type="button" class="btn secondary" data-bj="split">Split</button>` : ''}
    </div>`;
    return;
  }
  box.innerHTML = `<div class="bet-picker">
      <span class="bet-label small muted">Bet</span>
      <div class="bet-chips">${[10, 50, 100, 500, 1000].map((v) => `<button type="button" class="bet-chip c${v}" data-add="${v}" title="Add ${v}">${v >= 1000 ? `${v / 1000}k` : v}</button>`).join('')}</div>
      <span class="bet-amount"><span class="chip-icon sm" aria-hidden="true"></span><b>${chipsText(bjBet)}</b></span>
      <button type="button" class="link-btn" data-bj-bet="half">½</button>
      <button type="button" class="link-btn" data-bj-bet="double">2×</button>
      <button type="button" class="link-btn" data-bj-bet="clear">Clear</button>
    </div>
    <button type="button" class="btn deal-btn" data-bj="deal">${g ? 'Deal again' : 'Deal'}</button>`;
}

async function onBlackjackClick(e) {
  const add = e.target.closest('[data-add]');
  if (add) {
    bjBet = Math.min(10000, (bjBet === 0 ? 0 : bjBet) + Number(add.dataset.add));
    store.set('bjBet', String(bjBet));
    return renderBlackjackControls();
  }
  const change = e.target.closest('[data-bj-bet]');
  if (change) {
    const how = change.dataset.bjBet;
    bjBet = how === 'clear' ? 0 : how === 'half' ? Math.max(10, Math.floor(bjBet / 2)) : Math.min(10000, bjBet * 2);
    store.set('bjBet', String(bjBet));
    return renderBlackjackControls();
  }
  const b = e.target.closest('[data-bj]');
  if (!b || b.disabled) return;
  const action = b.dataset.bj;
  if (action === 'deal' && bjBet < 10) return toast('Bets start at 10 chips.');
  b.disabled = true;
  try {
    const before = casino.blackjack;
    const r = await api(casinoApi('/blackjack'), { method: 'POST', body: action === 'deal' ? { action, bet: bjBet } : { action } });
    casino.blackjack = r.blackjack;
    setWallet(r.wallet);
    renderBlackjack(action === 'deal' ? null : before);
  } catch (err) {
    toast(err.message);
    b.disabled = false;
  }
}

// ---- slots

let slotBet = Number(store.get('slotBet')) || 20;
let spinning = false;
const SLOT_ROW = 84; // px per symbol, set again from the CSS when the reels are measured

function buildSlots() {
  casinoPanes.slots.innerHTML = `
    ${SLOT_DEFS}
    <div class="slots">
      <div class="slot-cabinet">
        <div class="slot-machine">
          <div class="slot-marquee">
            <span class="slot-bulbs" aria-hidden="true">${'<i></i>'.repeat(18)}</span>
            <span class="slot-title"><span class="logo-mark" aria-hidden="true"></span>Ember Sevens</span>
            <span class="slot-sub">Five lines · flames are wild</span>
          </div>
          <div class="slot-bezel">
            <div class="slot-paylines left" aria-hidden="true"><b data-line="3">4</b><b data-line="1">2</b><b data-line="0">1</b><b data-line="2">3</b><b data-line="4">5</b></div>
            <div class="slot-window" id="slot-window">
              <div class="slot-reel"><div class="slot-strip"></div></div>
              <div class="slot-reel"><div class="slot-strip"></div></div>
              <div class="slot-reel"><div class="slot-strip"></div></div>
              <svg class="slot-lines" id="slot-lines" viewBox="0 0 300 300" preserveAspectRatio="none" aria-hidden="true"></svg>
            </div>
            <div class="slot-paylines right" aria-hidden="true"><b data-line="4">5</b><b data-line="1">2</b><b data-line="0">1</b><b data-line="2">3</b><b data-line="3">4</b></div>
          </div>
          <div class="slot-leds">
            <div class="slot-led"><span>Chips</span><b id="slot-credits">0</b></div>
            <div class="slot-led"><span>Bet</span><b id="slot-bet-led">0</b></div>
            <div class="slot-led win"><span>Win</span><b id="slot-win">0</b></div>
          </div>
          <div class="slot-result" id="slot-result" aria-live="polite">Pull the lever or press Spin.</div>
          <div class="slot-controls" id="slot-controls"></div>
          <div class="slot-tray" aria-hidden="true"></div>
        </div>
        <button type="button" class="slot-lever" id="slot-lever" aria-label="Pull the lever to spin"><span class="lever-arm"><span class="lever-ball"></span></span><span class="lever-base"></span></button>
      </div>
      <details class="paytable"><summary>What pays</summary><div id="paytable"></div></details>
    </div>`;
  casinoPanes.slots.addEventListener('click', onSlotsClick);
}

let slotsShown = ''; // the reels and pay table on screen, so they're redrawn when the server's change (after an update)
function renderSlotControls() {
  const d = casino.data;
  if (!d) return;
  const machine = JSON.stringify([d.slots.strips, d.slots.pays, d.slots.twoCherries]);
  if (slotsShown !== machine) {
    slotsShown = machine;
    // Each reel shows its strip several times over, so a spin has somewhere to go.
    casinoPanes.slots.querySelectorAll('.slot-strip').forEach((strip, r) => {
      const cells = d.slots.strips[r].map((sym) => `<span class="slot-sym" data-sym="${sym}">${SLOT_ART[sym]}</span>`).join('');
      strip.innerHTML = cells.repeat(5);
      strip.dataset.stop = String(randomStart(d.slots.strips[r].length));
      placeStrip(strip, Number(strip.dataset.stop), false);
    });
    $('#paytable').innerHTML = `<table class="pays">${Object.entries(d.slots.pays).reverse().map(([sym, x]) =>
      `<tr><td>${SLOT_ART[sym].repeat(3)}</td><td>${x}×</td></tr>`).join('')}
      <tr><td>${SLOT_ART.cherry.repeat(2)}<span class="muted"> + any</span></td><td>${d.slots.twoCherries}×</td></tr></table>
      <p class="small muted">Each winning line pays that many times your bet, and wins on different lines add up. The ${SLOT_ART.flame} stands in for anything.</p>`;
  }
  if (!d.slots.bets.includes(slotBet)) slotBet = d.slots.bets[1];
  $('#slot-controls').innerHTML = `
    <div class="slot-bet">
      <button type="button" class="slot-key" data-slot-bet="-1" aria-label="Smaller bet">−</button>
      <button type="button" class="slot-key" data-slot-bet="1" aria-label="Bigger bet">+</button>
      <button type="button" class="slot-key wide" data-slot-bet="max">Max bet</button>
    </div>
    <button type="button" class="spin-btn" id="slot-spin" ${spinning ? 'disabled' : ''}><span>Spin</span></button>`;
  $('#slot-bet-led').textContent = chipsText(slotBet);
  $('#slot-credits').textContent = chipsText(casino.wallet?.chips);
  $('#slot-lever').disabled = spinning;
}
const randomStart = (n) => Math.floor(Math.random() * n);

/** Puts a reel at a stop: that symbol in the top row. `copy` is which repeat of the strip to use. */
function placeStrip(strip, stop, animate, copy = 0, ms = 0) {
  const row = strip.firstElementChild?.offsetHeight || SLOT_ROW;
  const n = strip.children.length / 5;
  strip.style.transition = animate ? `transform ${ms}ms cubic-bezier(.18,.82,.25,1.04)` : 'none';
  strip.style.transform = `translateY(${-(copy * n + stop) * row}px)`;
}

function onSlotsClick(e) {
  const bet = e.target.closest('[data-slot-bet]');
  if (bet && !spinning) {
    const bets = casino.data.slots.bets;
    const step = bet.dataset.slotBet;
    // Max bet: the biggest you can afford.
    slotBet = step === 'max'
      ? [...bets].reverse().find((b) => b <= (casino.wallet?.chips ?? 0)) ?? bets[0]
      : bets[Math.max(0, Math.min(bets.length - 1, bets.indexOf(slotBet) + Number(step)))];
    store.set('slotBet', String(slotBet));
    return renderSlotControls();
  }
  if (e.target.closest('#slot-spin, #slot-lever')) spin();
}

async function spin() {
  if (spinning) return;
  spinning = true;
  renderSlotControls();
  $('#slot-lines').innerHTML = '';
  casinoPanes.slots.querySelectorAll('.slot-paylines b.on').forEach((b) => b.classList.remove('on'));
  const lever = $('#slot-lever');
  lever.classList.remove('pulled');
  lever.getBoundingClientRect();
  lever.classList.add('pulled');
  $('#slot-win').textContent = '0';
  $('#slot-result').textContent = 'Good luck…';
  $('#slot-result').className = 'slot-result';
  casinoPanes.slots.querySelectorAll('.slot-sym.hit').forEach((x) => x.classList.remove('hit'));
  let r;
  try {
    r = await api(casinoApi('/slots'), { method: 'POST', body: { bet: slotBet } });
  } catch (err) {
    spinning = false;
    renderSlotControls();
    $('#slot-result').textContent = err.message;
    return;
  }
  // Take the bet off straight away; the win shows up once the reels stop.
  setWallet({ ...casino.wallet, chips: r.wallet.chips - r.won });
  const strips = [...casinoPanes.slots.querySelectorAll('.slot-strip')];
  const durations = [1100, 1500, 1900];
  strips.forEach((strip, i) => {
    placeStrip(strip, Number(strip.dataset.stop), false, 0);
    strip.getBoundingClientRect(); // so the jump back isn't animated
    placeStrip(strip, r.stops[i], true, 3, durations[i]);
    strip.dataset.stop = String(r.stops[i]);
  });
  await new Promise((done) => setTimeout(done, durations[2] + 80));
  strips.forEach((strip, i) => placeStrip(strip, r.stops[i], false, 0));
  spinning = false;
  setWallet(r.wallet);
  renderSlotControls();
  showSlotWins(r, strips);
}

/** The win meter counts up to the win, like a real machine's. */
function countUp(el, to) {
  const start = performance.now(), ms = Math.min(1600, 300 + to / 4);
  const tick = (now) => {
    const k = Math.min(1, (now - start) / ms);
    el.textContent = chipsText(Math.round(to * k));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function showSlotWins(r, strips) {
  const res = $('#slot-result');
  if (!r.won) {
    res.textContent = 'No luck this time.';
    return;
  }
  const lines = casino.data.slots.lines;
  for (const w of r.wins) casinoPanes.slots.querySelectorAll(`.slot-paylines b[data-line="${w.line}"]`).forEach((b) => b.classList.add('on'));
  countUp($('#slot-win'), r.won);
  const machine = casinoPanes.slots.querySelector('.slot-machine');
  machine.classList.add('won');
  setTimeout(() => machine.classList.remove('won'), 2500);
  const svg = $('#slot-lines');
  svg.innerHTML = r.wins.map((w) => {
    const pts = lines[w.line].map((row, reel) => `${50 + reel * 100},${50 + row * 100}`).join(' ');
    return `<polyline points="${pts}" />`;
  }).join('');
  for (const w of r.wins)
    lines[w.line].forEach((row, reel) => {
      const n = strips[reel].children.length / 5;
      strips[reel].children[(r.stops[reel] + row) % n]?.classList.add('hit');
    });
  const jackpot = r.wins.some((w) => lines[w.line].every((row, reel) => r.grid[reel][row] === 'flame'));
  res.textContent = jackpot ? `JACKPOT! +${chipsText(r.won)}` : `You win ${chipsText(r.won)}!`;
  res.className = 'slot-result win' + (r.won >= slotBet * 10 ? ' big' : '');
  if (r.won >= slotBet * 20) playSound('message');
}

// ---- cases

let openCase = null; // the case being looked at
let caseView = 'cases'; // or 'inventory' or 'book'
let opening = false;
let caseCount = 1; // how many to open at once
let lastDrops = null; // what the last multi-open got: { items, c, fresh }
let invSort = 'new';
// Inventory filters, and the skins picked to sell together.
const invFilter = { type: 'all', rarity: 'all', wear: 'all', box: 'all', stattrak: false };
let invPicking = false;
const invPicked = new Set();
const INV_TYPES = [
  ['knife', 'Knives'], ['gloves', 'Gloves'], ['rifle', 'Rifles'], ['sniper', 'Snipers'], ['pistol', 'Pistols'], ['smg', 'SMGs'], ['shotgun', 'Shotguns'],
];

function buildCases() {
  casinoPanes.cases.innerHTML = `
    <div class="cases">
      <div class="cases-nav">
        <button type="button" class="seg" data-case-view="cases">Cases</button>
        <button type="button" class="seg" data-case-view="inventory">Inventory <span id="inv-count"></span></button>
        <button type="button" class="seg" data-case-view="book">Collection <span id="book-count"></span></button>
        <button type="button" class="seg" data-case-view="tradeup">Trade up</button>
        <button type="button" class="seg" data-case-view="upgrade">Upgrade</button>
      </div>
      <div id="cases-main"></div>
    </div>`;
  casinoPanes.cases.addEventListener('click', onCasesClick);
  casinoPanes.cases.addEventListener('change', (e) => {
    if (e.target.id === 'inv-sort') { invSort = e.target.value; renderInventory(); }
    if (e.target.matches('[data-book-case]')) { bookCase = e.target.value; renderBook(); }
    if (e.target.matches('[data-book-missing]')) { bookMissing = e.target.checked; renderBook(); }
    const f = e.target.dataset.invFilter;
    if (f) {
      invFilter[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      renderInventory();
    }
  });
}

const skinById = (id) => {
  for (const c of casino.data?.cases ?? []) {
    const s = c.skins.find((x) => x.id === id);
    if (s) return s;
  }
  return null;
};
const skinTitle = (s, stattrak = false) => `${s.rarity === 'rare' ? '★ ' : ''}${stattrak ? 'StatTrak™ ' : ''}${s.weapon} | ${s.name}`;

function renderCases() {
  if (!casino.data) return;
  casinoPanes.cases.querySelectorAll('[data-case-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.caseView === caseView)));
  $('#inv-count').textContent = casino.inventory.length ? `(${casino.inventory.length})` : '';
  $('#book-count').textContent = bookCount();
  if (opening) return;
  if (caseView === 'inventory') return renderInventory();
  if (caseView === 'book') return renderBook();
  if (caseView === 'tradeup') return renderTradeUp();
  if (caseView === 'upgrade') return renderUpgrade();
  if (openCase) return renderCaseDetail();
  $('#cases-main').innerHTML = `<div class="case-grid">${casino.data.cases.map((c) => `
    <button type="button" class="case-card" data-case="${c.id}">
      ${caseArt(c)}
      <span class="case-weapon">${skinArt(c.skins.find((s) => s.rarity === 'covert'))}</span>
      <b>${escapeHtml(c.name)}</b>
      <span class="case-price"><span class="chip-icon sm" aria-hidden="true"></span>${chipsText(c.price)}</span>
    </button>`).join('')}</div>
    <section class="top-pulls" id="top-pulls"></section>`;
  renderTopPulls();
  loadTopPulls();
}

/** A skin on a tile. In the case's reel a knife or gloves spins past as a gold star, like in CS. */
function itemTile(skin, extra = '', { float, star = false } = {}) {
  return `<div class="item-tile r-${skin.rarity}" style="--rarity:${RARITY[skin.rarity].color}">
    <div class="item-art">${star && skin.rarity === 'rare' ? '<span class="rare-mark">★</span>' : skinArt(skin, float)}</div>
    <div class="item-name"><span class="small">${escapeHtml(skin.weapon)}</span><b>${escapeHtml(skin.name)}</b></div>${extra}</div>`;
}

const caseCounts = () => casino.data.caseCounts ?? [1];
const openLabel = (c) => `Open ${caseCount > 1 ? `${caseCount} ` : ''}for <span class="chip-icon sm" aria-hidden="true"></span>${chipsText(c.price * caseCount)}`;

function renderCaseDetail() {
  const c = openCase;
  const counts = caseCounts();
  if (!counts.includes(caseCount)) caseCount = 1;
  const odds = casino.data.rarityOdds;
  const groups = Object.keys(RARITY).map((r) => {
    const skins = c.skins.filter((s) => s.rarity === r);
    const pct = (odds[r] / 100).toFixed(odds[r] < 100 ? 2 : 1);
    return `<div class="case-group"><h4 style="--rarity:${RARITY[r].color}">${RARITY[r].name} <span class="small muted">${pct}%</span></h4>
      <div class="item-grid">${r === 'rare' ? `<div class="item-tile r-rare" style="--rarity:${RARITY.rare.color}"><div class="item-art"><span class="rare-mark">★</span></div><div class="item-name"><span class="small">Rare Special</span><b>${skins.length} knives and gloves</b></div></div>`
        : skins.map((s) => itemTile(s, `<span class="item-value small muted">~${chipsText(s.value)}</span>`)).join('')}</div></div>`;
  }).join('');
  $('#cases-main').innerHTML = `
    <div class="case-head">
      <button type="button" class="icon-btn" data-case-back aria-label="All cases"><svg viewBox="0 0 24 24"><path d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12l6.6-6.6Z"/></svg></button>
      <h3>${escapeHtml(c.name)}</h3>
      ${counts.length > 1 ? `<div class="count-pick" role="group" aria-label="How many to open">${counts.map((n) => `<button type="button" data-case-count="${n}" aria-pressed="${n === caseCount}">×${n}</button>`).join('')}</div>` : ''}
      <button type="button" class="btn open-btn" data-open="${c.id}">${openLabel(c)}</button>
    </div>
    <div id="case-reels"></div>
    <div id="case-drop"></div>
    <div class="case-contents">${groups}</div>`;
}

/** A random skin for the reel's filler, at about the odds of opening one. */
function fillerSkin(c) {
  const odds = casino.data.rarityOdds;
  let roll = Math.random() * 10000;
  const rarity = Object.keys(odds).find((r) => (roll -= odds[r]) < 0) ?? 'milspec';
  const pool = c.skins.filter((s) => s.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

async function openTheCase(c) {
  if (opening) return;
  opening = true;
  const n = caseCount;
  const btn = $('#cases-main .open-btn');
  if (btn) btn.disabled = true;
  $('#case-drop').innerHTML = '';
  lastDrops = null;
  let r;
  try {
    r = await api(casinoApi(`/cases/${c.id}/open`), { method: 'POST', body: n > 1 ? { count: n } : {} });
  } catch (err) {
    opening = false;
    if (btn) btn.disabled = false;
    return toast(err.message);
  }
  setWallet({ ...casino.wallet, chips: r.wallet.chips });
  const got = r.items ?? [r.item];
  // One reel per case, all spinning at once. With several, the reels are smaller and a bit shorter.
  const WIN_AT = got.length > 1 ? 30 : 46;
  const reels = $('#case-reels');
  reels.className = got.length > 1 ? `multi n${got.length}` : '';
  reels.innerHTML = got.map(() => '<div class="case-reel"><div class="case-strip"></div><span class="case-marker" aria-hidden="true"></span></div>').join('');
  const strips = [...reels.querySelectorAll('.case-strip')];
  strips.forEach((strip, i) => {
    const items = Array.from({ length: WIN_AT + 8 }, (_, k) => (k === WIN_AT ? skinById(got[i].skinId) : fillerSkin(c)));
    strip.innerHTML = items.map((s, k) => itemTile(s, '', k === WIN_AT ? { float: got[i].float } : { star: true })).join('');
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0)';
  });
  const ms = got.length > 1 ? 4200 : 5600;
  reels.getBoundingClientRect();
  strips.forEach((strip, i) => {
    const reel = strip.parentElement;
    const tile = strip.firstElementChild;
    const step = tile.offsetWidth + parseFloat(getComputedStyle(strip).columnGap || '8');
    const land = WIN_AT * step + tile.offsetWidth * (0.15 + Math.random() * 0.7) - reel.clientWidth / 2;
    const t = ms + i * 60;
    strip.style.transition = `transform ${t}ms cubic-bezier(.08,.6,.12,1)`;
    strip.style.transform = `translateX(${-land}px)`;
  });
  reels.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  await new Promise((done) => setTimeout(done, ms + (got.length - 1) * 60 + 150));
  strips.forEach((strip) => strip.children[WIN_AT].classList.add('landed'));
  opening = false;
  topPulls = null; // so the day's top pulls are fresh next time
  casino.inventory.unshift(...[...got].reverse());
  $('#inv-count').textContent = `(${casino.inventory.length})`;
  // New to the book: skins you didn't have before (the first of each, if one came up twice).
  const had = new Set(casino.found.map((f) => f.skinId));
  const fresh = new Set();
  for (const item of got) if (!had.has(item.skinId)) { had.add(item.skinId); fresh.add(item.id); }
  if (r.found) casino.found = r.found;
  $('#book-count').textContent = bookCount();
  if (btn) btn.disabled = false;
  if (got.length === 1) return showDrop(got[0], c, fresh.size > 0);
  lastDrops = { items: got, c, fresh };
  showDrops();
  // With many reels the results are far down (on a phone especially), so bring them up.
  setTimeout(() => $('#case-drop')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 700);
}

/** What several cases gave, as a grid: click one to keep, sell or show it; or sell them all. */
function showDrops() {
  const { items, c, fresh } = lastDrops;
  const left = items.filter((i) => casino.inventory.some((x) => x.id === i.id));
  const worth = left.reduce((n, i) => n + i.value, 0);
  const best = [...items].sort((a, b) => b.value - a.value)[0];
  const box = $('#case-drop');
  box.innerHTML = `<div class="drops">
    <div class="drops-head">
      <b>${items.length} skins · worth <span class="chip-icon sm" aria-hidden="true"></span>${chipsText(items.reduce((n, i) => n + i.value, 0))}</b>
      <span class="small muted">Spent ${chipsText(c.price * items.length)}${fresh.size ? ` · ${fresh.size} new in your book` : ''}</span>
    </div>
    <div class="item-grid">${items.map((i) => {
      const { skin } = itemDetails(i);
      const sold = !left.includes(i);
      return `<button type="button" class="inv-item drop-item ${sold ? 'sold' : ''}" data-drop-item="${i.id}" ${sold ? 'disabled' : ''}>${itemTile(skin, `${floatLine(i.float)}<span class="item-meta small">${i.stattrak ? '<span class="stattrak">ST</span> ' : ''}${chipValue(i.value)}${sold ? ' · Sold' : ''}</span>`, { float: i.float })}${fresh.has(i.id) ? '<span class="new-mark">New</span>' : ''}</button>`;
    }).join('')}</div>
    <div class="drop-actions">
      <button type="button" class="btn" data-open="${c.id}">Open ${items.length} more (${chipsText(c.price * items.length)})</button>
      ${left.length ? `<button type="button" class="btn secondary" data-sell-drops>Sell ${left.length === items.length ? 'all' : `the other ${left.length}`} for ${chipsText(worth)}</button>` : ''}
      <button type="button" class="btn secondary" data-brag>Show the fire</button>
    </div>
  </div>`;
  const { title, wear } = itemDetails(best);
  box.dataset.brag = `🎁 Opened ${items.length} ${c.name}s. Best: ${title} (${wear.name}), worth ${chipsText(best.value)} chips`;
  if (items.some((i) => ['covert', 'rare'].includes(skinById(i.skinId).rarity))) playSound('message');
}

function itemDetails(item) {
  const skin = skinById(item.skinId);
  const wear = wearOf(item.float, casino.data.wears);
  return { skin, wear, title: skinTitle(skin, item.stattrak) };
}

function dropHtml(item) {
  const { skin, wear, title } = itemDetails(item);
  return `<div class="drop r-${skin.rarity}" style="--rarity:${RARITY[skin.rarity].color}">
    <div class="drop-art">${skinArt(skin, item.float)}</div>
    <div class="drop-info">
      <span class="drop-rarity">${RARITY[skin.rarity].name}${item.stattrak ? ' · <span class="stattrak">StatTrak™</span>' : ''}</span>
      <h3>${escapeHtml(title)}</h3>
      <span class="small muted">${wear.name}</span>
      <span class="drop-float">Float <b>${item.float.toFixed(14)}</b></span>${floatBar(item.float)}
      <span class="drop-value"><span class="chip-icon sm" aria-hidden="true"></span>${chipsText(item.value)}</span>
    </div>
  </div>`;
}

function showDrop(item, c, isNew = false) {
  const { skin, wear, title } = itemDetails(item);
  const box = $('#case-drop');
  box.innerHTML = `${dropHtml(item)}${isNew ? '<p class="drop-new">New in your collection book!</p>' : ''}
    <div class="drop-actions">
      <button type="button" class="btn" data-open="${c.id}">Open another (${chipsText(c.price)})</button>
      <button type="button" class="btn secondary" data-sell="${item.id}">Sell for ${chipsText(item.value)}</button>
      <button type="button" class="btn secondary" data-brag="${item.id}">Show the fire</button>
    </div>`;
  box.dataset.brag = `🎁 Unboxed ${title} (${wear.name}) from the ${c.name}, worth ${chipsText(item.value)} chips`;
  if (['covert', 'rare'].includes(skin.rarity)) playSound('message');
}

// ---- the collection book: every skin in every case, lit up once you've unboxed it (selling doesn't take it out)

const allSkins = () => (casino.data?.cases ?? []).flatMap((c) => c.skins);
function bookCount() {
  const total = allSkins().length;
  return total ? `${casino.found.length}/${total}` : '';
}
let bookCase = 'all';
let bookMissing = false;

function renderBook() {
  const found = new Map(casino.found.map((f) => [f.skinId, f]));
  const cases = casino.data.cases;
  const all = allSkins();
  const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0);
  const bar = (n, of) => `<span class="book-bar" role="progressbar" aria-valuenow="${n}" aria-valuemax="${of}"><span style="width:${pct(n, of)}%"></span></span>`;
  // Rarest first within each case, like the case's own list.
  const order = (a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || b.value - a.value;
  const tile = (s) => {
    const f = found.get(s.id);
    if (f) {
      const times = f.count > 1 ? `×${f.count} · ` : '';
      return itemTile(s, `<span class="item-meta small">${f.stattrak ? '<span class="stattrak">ST</span> ' : ''}${times}Best float</span>${floatLine(f.bestFloat)}`, { float: f.bestFloat });
    }
    // Not found yet: a shadow of the gun. Knives and gloves stay a mystery, like in the case.
    if (s.rarity === 'rare') return `<div class="item-tile r-rare missing" style="--rarity:${RARITY.rare.color}"><div class="item-art"><span class="rare-mark">★</span></div><div class="item-name"><span class="small">${escapeHtml(s.weapon)}</span><b>???</b></div><span class="item-meta small">Not found yet</span></div>`;
    return `<div class="item-tile r-${s.rarity} missing" style="--rarity:${RARITY[s.rarity].color}"><div class="item-art">${skinArt(s)}</div><div class="item-name"><span class="small">${escapeHtml(s.weapon)}</span><b>${escapeHtml(s.name)}</b></div><span class="item-meta small">Not found yet</span></div>`;
  };
  const shown = cases.filter((c) => bookCase === 'all' || c.id === bookCase);
  $('#cases-main').innerHTML = `
    <div class="book">
      <div class="book-head">
        <div class="book-total"><b>${casino.found.length} of ${all.length}</b> skins found ${bar(casino.found.length, all.length)}<span class="small muted">${pct(casino.found.length, all.length)}%</span></div>
        <div class="inv-filters">
          <select data-book-case aria-label="Case"><option value="all">Every case</option>${cases.map((c) => `<option value="${c.id}" ${bookCase === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
          <label class="inv-st"><input type="checkbox" data-book-missing ${bookMissing ? 'checked' : ''}> Missing only</label>
        </div>
      </div>
      ${shown.map((c) => {
        const have = c.skins.filter((s) => found.has(s.id)).length;
        const skins = [...c.skins].sort(order).filter((s) => !bookMissing || !found.has(s.id));
        return `<section class="book-case">
          <h4>${escapeHtml(c.name)} <span class="small muted">${have}/${c.skins.length}</span>${bar(have, c.skins.length)}${have === c.skins.length ? '<span class="book-done">Complete!</span>' : ''}</h4>
          ${skins.length ? `<div class="item-grid">${skins.map(tile).join('')}</div>` : '<p class="small muted">You have every skin in this case.</p>'}
        </section>`;
      }).join('')}
      <p class="small muted">Skins stay in your book after you sell them. Ones you opened before the book existed count if they were still in your inventory.</p>
    </div>`;
}

const caseOfSkin = (skinId) => casino.data?.cases.find((c) => c.skins.some((x) => x.id === skinId));

/** A skin's float the way CS lists it, to 14 places, with its wear. */
const floatLine = (float) => {
  const wear = wearOf(float, casino.data.wears);
  return `<span class="item-float" title="${wear.name}"><span>${float.toFixed(14)}</span><b>${wear.short}</b></span>`;
};
/** Where the float sits from 0 (factory new) to 1 (battle-scarred). */
const floatBar = (float) => `<span class="float-bar" aria-hidden="true"><i style="left:${(float * 100).toFixed(2)}%"></i></span>`;
const chipValue = (n) => `<span class="chip-icon sm" aria-hidden="true"></span>${chipsText(n)}`;

/** The inventory items that pass the filters, sorted. */
function shownItems() {
  const wears = casino.data.wears;
  return casino.inventory.filter((i) => {
    const skin = skinById(i.skinId);
    if (!skin) return false;
    if (invFilter.type !== 'all' && skin.kind !== invFilter.type) return false;
    if (invFilter.rarity !== 'all' && skin.rarity !== invFilter.rarity) return false;
    if (invFilter.wear !== 'all' && wearOf(i.float, wears).short !== invFilter.wear) return false;
    if (invFilter.box !== 'all' && caseOfSkin(i.skinId)?.id !== invFilter.box) return false;
    if (invFilter.stattrak && !i.stattrak) return false;
    return true;
  }).sort((a, b) => (invSort === 'value' ? b.value - a.value : invSort === 'float' ? a.float - b.float : invSort === 'rarity'
    ? RARITY_ORDER.indexOf(skinById(a.skinId).rarity) - RARITY_ORDER.indexOf(skinById(b.skinId).rarity) || b.value - a.value
    : b.id - a.id));
}
const RARITY_ORDER = ['rare', 'covert', 'classified', 'restricted', 'milspec'];

function renderInventory() {
  // Sold or gone: no longer picked.
  for (const id of invPicked) if (!casino.inventory.some((i) => i.id === id)) invPicked.delete(id);
  if (!casino.inventory.length) {
    invPicking = false;
    $('#cases-main').innerHTML = '<p class="muted empty-inv">Nothing here yet. What you open from cases lands here, and you can sell it back for chips.</p>';
    return;
  }
  const items = shownItems();
  const total = items.reduce((n, i) => n + i.value, 0);
  const filtered = invFilter.type !== 'all' || invFilter.rarity !== 'all' || invFilter.wear !== 'all' || invFilter.box !== 'all' || invFilter.stattrak;
  const kinds = new Set(casino.inventory.map((i) => skinById(i.skinId)?.kind));
  const count = (kind) => casino.inventory.filter((i) => skinById(i.skinId)?.kind === kind).length;
  const option = (key, value, label) => `<option value="${value}" ${invFilter[key] === value ? 'selected' : ''}>${label}</option>`;
  const picked = casino.inventory.filter((i) => invPicked.has(i.id));
  const sellable = picked.filter((i) => !i.locked);
  const pickedValue = sellable.reduce((n, i) => n + i.value, 0);
  const allLocked = picked.length > 0 && picked.every((i) => i.locked);
  const forSale = items.filter((i) => !i.locked);
  $('#cases-main').innerHTML = `
    <div class="inv-types" role="group" aria-label="Show">
      <button type="button" class="chip-filter" data-inv-type="all" aria-pressed="${invFilter.type === 'all'}">All <span>${casino.inventory.length}</span></button>
      ${INV_TYPES.filter(([k]) => kinds.has(k)).map(([k, label]) => `<button type="button" class="chip-filter" data-inv-type="${k}" aria-pressed="${invFilter.type === k}">${label} <span>${count(k)}</span></button>`).join('')}
    </div>
    <div class="inv-filters">
      <select data-inv-filter="rarity" aria-label="Rarity">${option('rarity', 'all', 'Any rarity')}${RARITY_ORDER.map((r) => option('rarity', r, RARITY[r].name)).join('')}</select>
      <select data-inv-filter="wear" aria-label="Wear">${option('wear', 'all', 'Any wear')}${casino.data.wears.map((w) => option('wear', w.short, w.name)).join('')}</select>
      <select data-inv-filter="box" aria-label="Case">${option('box', 'all', 'Any case')}${casino.data.cases.map((c) => option('box', c.id, escapeHtml(c.name))).join('')}</select>
      <label class="inv-st"><input type="checkbox" data-inv-filter="stattrak" ${invFilter.stattrak ? 'checked' : ''} /> StatTrak™ only</label>
      <select id="inv-sort" aria-label="Sort">
        <option value="new" ${invSort === 'new' ? 'selected' : ''}>Newest</option>
        <option value="value" ${invSort === 'value' ? 'selected' : ''}>Most valuable</option>
        <option value="rarity" ${invSort === 'rarity' ? 'selected' : ''}>Rarest</option>
        <option value="float" ${invSort === 'float' ? 'selected' : ''}>Lowest float</option>
      </select>
    </div>
    <div class="inv-head">
      <span>${filtered ? `${items.length} of ${casino.inventory.length} shown · ` : ''}Worth <b><span class="chip-icon sm" aria-hidden="true"></span>${chipsText(total)}</b></span>
      ${filtered ? '<button type="button" class="link-btn" data-inv-clear>Clear filters</button>' : ''}
      <button type="button" class="btn secondary inv-pick-btn" data-inv-pick aria-pressed="${invPicking}">${invPicking ? 'Done' : 'Select'}</button>
      ${forSale.length ? `<button type="button" class="link-btn danger-link" data-sell-all>${filtered ? `Sell these ${forSale.length}` : forSale.length < items.length ? `Sell all ${forSale.length} unlocked` : 'Sell everything'}</button>` : ''}
    </div>
    ${items.length ? `<div class="item-grid inv ${invPicking ? 'picking' : ''}">${items.map((i) => {
      const { skin } = itemDetails(i);
      const on = invPicked.has(i.id);
      return `<button type="button" class="inv-item ${on ? 'picked' : ''}" data-item="${i.id}" ${invPicking ? `aria-pressed="${on}"` : ''}>${itemTile(skin, `${floatLine(i.float)}<span class="item-meta small">${i.stattrak ? '<span class="stattrak">ST</span> ' : ''}${chipValue(i.value)}</span>`, { float: i.float })}${lockMark(i)}<span class="pick-mark" aria-hidden="true"></span></button>`;
    }).join('')}</div>` : '<p class="muted empty-inv">Nothing matches these filters.</p>'}
    ${invPicking ? `<div class="sell-bar">
      <span><b>${picked.length}</b> selected${picked.length ? ` · <span class="chip-icon sm" aria-hidden="true"></span>${chipsText(pickedValue)}` : ''}</span>
      <button type="button" class="link-btn" data-pick-all>Select all ${items.length} shown</button>
      ${picked.length ? '<button type="button" class="link-btn" data-pick-none>Clear</button>' : ''}
      ${picked.length ? `<button type="button" class="btn secondary" data-lock-picked="${allLocked ? 'off' : 'on'}">${lockIcon}${allLocked ? 'Unlock' : 'Lock'}</button>` : ''}
      <button type="button" class="btn" data-sell-picked ${sellable.length ? '' : 'disabled'}>Sell ${sellable.length || ''} for ${chipsText(pickedValue)}</button>
    </div>` : ''}`;
}

const lockIcon = '<svg class="lock-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 0 1 6 0v3H9Z"/></svg>';
const lockMark = (i) => (i.locked ? `<span class="lock-mark" title="Locked">${lockIcon}</span>` : '');

/** Locks skins so they can't be sold by accident (or unlocks them). */
async function lockItems(ids, locked) {
  if (!ids.length) return false;
  try {
    await api(casinoApi('/items/lock'), { method: 'POST', body: { ids, locked } });
    for (const i of casino.inventory) if (ids.includes(i.id)) i.locked = locked;
    toast(locked ? `Locked ${ids.length === 1 ? 'it' : `${ids.length} skins`}. Locked skins can't be sold until you unlock them.` : 'Unlocked.');
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

async function sellItems(ids) {
  try {
    const r = await api(casinoApi('/items/sell'), { method: 'POST', body: { ids } });
    casino.inventory = casino.inventory.filter((i) => !ids.includes(i.id));
    setWallet(r.wallet);
    toast(`Sold for ${chipsText(r.got)} chips.`);
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

async function onCasesClick(e) {
  const t = e.target;
  if ((caseView === 'tradeup' || caseView === 'upgrade') && !t.closest('[data-case-view]') && onTradeClick(t)) return;
  const view = t.closest('[data-case-view]');
  if (view && !opening) { caseView = view.dataset.caseView; return renderCases(); }
  const card = t.closest('[data-case]');
  if (card) { openCase = casino.data.cases.find((c) => c.id === card.dataset.case); return renderCases(); }
  if (t.closest('[data-case-back]') && !opening) { openCase = null; return renderCases(); }
  const count = t.closest('[data-case-count]');
  if (count && !opening) {
    caseCount = Number(count.dataset.caseCount);
    casinoPanes.cases.querySelectorAll('[data-case-count]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.caseCount) === caseCount)));
    $('#cases-main .open-btn').innerHTML = openLabel(openCase);
    return;
  }
  const drop = t.closest('[data-drop-item]');
  if (drop) return openItem(casino.inventory.find((i) => i.id === Number(drop.dataset.dropItem)), () => lastDrops && showDrops());
  if (t.closest('[data-sell-drops]') && lastDrops) {
    const ids = lastDrops.items.filter((i) => casino.inventory.some((x) => x.id === i.id && !x.locked)).map((i) => i.id);
    if (await sellItems(ids)) showDrops();
    $('#inv-count').textContent = casino.inventory.length ? `(${casino.inventory.length})` : '';
    return;
  }
  const open = t.closest('[data-open]');
  if (open) {
    if (!openCase || openCase.id !== open.dataset.open) { openCase = casino.data.cases.find((c) => c.id === open.dataset.open); renderCases(); }
    return openTheCase(openCase);
  }
  const sell = t.closest('[data-sell]');
  if (sell) {
    sell.disabled = true;
    if (await sellItems([Number(sell.dataset.sell)])) $('#case-drop').querySelector('.drop-actions [data-sell]')?.remove();
    $('#inv-count').textContent = casino.inventory.length ? `(${casino.inventory.length})` : '';
    return;
  }
  if (t.closest('[data-brag]')) return brag($('#case-drop').dataset.brag);
  if (t.closest('[data-sell-all]')) {
    const items = shownItems().filter((i) => !i.locked);
    const total = items.reduce((n, i) => n + i.value, 0);
    const locked = casino.inventory.filter((i) => i.locked).length;
    if (!confirm(`Sell ${items.length === casino.inventory.length ? 'all ' : ''}${items.length} items for ${chipsText(total)} chips?${locked ? ` Your ${locked} locked ${locked === 1 ? 'skin stays' : 'skins stay'}.` : ''}`)) return;
    if (await sellItems(items.map((i) => i.id))) renderCases();
    return;
  }
  const type = t.closest('[data-inv-type]');
  if (type) { invFilter.type = type.dataset.invType; return renderInventory(); }
  if (t.closest('[data-inv-clear]')) {
    Object.assign(invFilter, { type: 'all', rarity: 'all', wear: 'all', box: 'all', stattrak: false });
    return renderInventory();
  }
  if (t.closest('[data-inv-pick]')) {
    invPicking = !invPicking;
    if (!invPicking) invPicked.clear();
    return renderInventory();
  }
  if (t.closest('[data-pick-all]')) { for (const i of shownItems()) invPicked.add(i.id); return renderInventory(); }
  if (t.closest('[data-pick-none]')) { invPicked.clear(); return renderInventory(); }
  const lockPicked = t.closest('[data-lock-picked]');
  if (lockPicked) {
    await lockItems([...invPicked], lockPicked.dataset.lockPicked === 'on');
    return renderInventory();
  }
  if (t.closest('[data-sell-picked]')) {
    const items = casino.inventory.filter((i) => invPicked.has(i.id) && !i.locked);
    const total = items.reduce((n, i) => n + i.value, 0);
    if (!items.length || !confirm(`Sell ${items.length} item${items.length === 1 ? '' : 's'} for ${chipsText(total)} chips?`)) return;
    if (await sellItems(items.map((i) => i.id))) { invPicked.clear(); invPicking = false; renderCases(); }
    return;
  }
  const inv = t.closest('[data-item]');
  if (inv) {
    const id = Number(inv.dataset.item);
    // Picking (or Ctrl/Cmd-click, which starts picking): toggle it; otherwise open it.
    if (invPicking || e.ctrlKey || e.metaKey) {
      invPicking = true;
      if (invPicked.has(id)) invPicked.delete(id);
      else invPicked.add(id);
      return renderInventory();
    }
    return openItem(casino.inventory.find((i) => i.id === id));
  }
}

function openItem(item, onSold = renderCases) {
  if (!item) return;
  const { wear, title } = itemDetails(item);
  modal(`${dropHtml(item)}
    <div class="modal-row">
      <button type="button" class="btn secondary" id="item-lock" aria-pressed="${!!item.locked}">${lockIcon}${item.locked ? 'Unlock' : 'Lock'}</button>
      <button type="button" class="btn secondary" id="item-brag">Show the fire</button>
      ${item.locked ? '<button type="button" class="btn" data-close>Keep</button>' : `<button type="button" class="btn" id="item-sell">Sell for ${chipsText(item.value)}</button>`}
    </div>
    ${item.locked ? '<p class="small muted lock-note">Locked: it can\'t be sold, traded up or upgraded until you unlock it.</p>' : ''}`, 'drop-modal');
  if ($('#item-sell')) $('#item-sell').onclick = async () => {
    if (await sellItems([item.id])) { closeModal(); onSold(); }
  };
  $('#item-lock').onclick = async () => {
    if (await lockItems([item.id], !item.locked)) { openItem(casino.inventory.find((i) => i.id === item.id), onSold); onSold(); }
  };
  $('#item-brag').onclick = () => { closeModal(); brag(`🎒 Showing off ${title} (${wear.name}), worth ${chipsText(item.value)} chips`); };
}

// Keys: Space spins the slots when they're on screen.
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || !casinoOnScreen() || casino.tab !== 'slots') return;
  if (e.target.closest?.('input, textarea, select, button, [contenteditable]') || !$('#modal').classList.contains('hidden')) return;
  e.preventDefault();
  spin();
});
