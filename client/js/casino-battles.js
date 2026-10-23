// Case battles (the casino's Battles tab): two to four people at the fire open the same cases, round
// by round, and the highest total takes every skin. Free for all, or 2v2 (seats 1-2 against 3-4).
// Empty seats can take a bot. The server opens everything when the last seat fills; this file
// shows it round by round, at the pace the server gives (roundMs), so everyone sees the same thing.

const battles = {
  list: [], // the battles at your fire
  watching: null, // the battle on screen, by id
  playing: null, // { id, timers } while its rounds play
  draft: { mode: 'ffa', players: 2, cases: {} }, // the create form
};
const BATTLE_MAX_ROUNDS = 10;

function buildBattles() {
  casinoPanes.battles.innerHTML = '<div class="battles" id="battles-main"></div>';
  casinoPanes.battles.addEventListener('click', onBattlesClick);
}

/** The server says what the fire's battles are now. */
function onCaseBattles(ev) {
  if (ev.channelId !== state.voice?.channelId) return;
  const at = performance.now();
  const before = new Map(battles.list.map((b) => [b.id, b]));
  battles.list = ev.battles.map((b) => ({ ...b, seenAt: at }));
  for (const b of battles.list) {
    const was = before.get(b.id);
    // A battle you're in just started: go and watch it.
    if (b.started && was && !was.started && b.seats.some((s) => s?.userId === state.me.id)) {
      if (casinoOnScreen() && casino.tab === 'battles') battles.watching = b.id;
      else toast('Your case battle started.', { action: 'Watch', onAction: () => { battles.watching = b.id; openCasino('battles'); } });
    }
  }
  if (battles.watching && !battles.list.some((b) => b.id === battles.watching)) battles.watching = null;
  renderBattles();
}

const battleBox = (id) => casino.data?.cases.find((c) => c.id === id);
const battleNow = (b) => b.elapsed + (performance.now() - b.seenAt);
const seatName = (s) => (s.bot ? s.bot : s.userId === state.me.id ? 'You' : nameOf(s.userId, 'Player'));
const modeText = (b) => (b.mode === '2v2' ? '2v2' : `Free for all · ${b.seats.length} players`);

function renderBattles() {
  const main = $('#battles-main');
  if (!main || !casino.data) return;
  const b = battles.list.find((x) => x.id === battles.watching);
  if (b?.started) return playBattle(b);
  stopBattle();
  main.innerHTML = `
    <div class="battles-head">
      <div><h3>Case battles</h3><p class="small muted">Everyone opens the same cases. The highest total takes every skin.</p></div>
      <button type="button" class="btn" data-battle-new>Create battle</button>
    </div>
    ${battles.list.length ? `<div class="battle-list">${battles.list.map(battleCard).join('')}</div>`
      : '<p class="empty-inv muted">No battles at this fire yet. Start one, and anyone at the fire can join.</p>'}`;
  drawAvatars(main);
}
const drawAvatars = (root) =>
  root.querySelectorAll('[data-avatar]').forEach((el) => setAvatar(el, nameOf(Number(el.dataset.avatar), 'Player'), avatarOf(Number(el.dataset.avatar))));

/** Cases in a battle, grouped: Ember ×3, Aurora ×1. */
function caseRow(ids) {
  const groups = [];
  for (const id of ids) {
    const g = groups.at(-1);
    if (g?.id === id) g.n++;
    else groups.push({ id, n: 1 });
  }
  return `<div class="battle-cases">${groups.map(({ id, n }) => {
    const c = battleBox(id);
    return c ? `<span class="battle-case" title="${escapeHtml(c.name)}">${caseArt(c)}${n > 1 ? `<b>×${n}</b>` : ''}</span>` : '';
  }).join('')}</div>`;
}

function battleCard(b) {
  const mine = b.creator === state.me.id;
  const inIt = b.seats.some((s) => s?.userId === state.me.id);
  const seat = (s, i) => {
    if (s) {
      const remove = mine && !b.started && s.userId !== state.me.id ? `<button type="button" class="seat-x" data-battle-kick="${i}" aria-label="Remove">×</button>` : '';
      return `<span class="b-seat ${s.bot ? 'bot' : ''}">${s.bot ? '<span class="bot-face" aria-hidden="true">🤖</span>' : `<span class="avatar b-av" data-avatar="${s.userId}"></span>`}<span>${escapeHtml(seatName(s))}</span>${remove}</span>`;
    }
    if (b.started) return '';
    return `<span class="b-seat open">
      ${inIt ? '<span class="muted">Open seat</span>' : `<button type="button" class="btn small" data-battle-join="${i}">Join</button>`}
      ${mine ? `<button type="button" class="btn secondary small" data-battle-bot="${i}">Add bot</button>` : ''}
    </span>`;
  };
  const sides = b.mode === '2v2' ? [[0, 1], [2, 3]] : [b.seats.map((_, i) => i)];
  return `<div class="battle-card ${b.started ? 'started' : ''}" data-battle="${b.id}">
    <div class="battle-card-top">
      <b>${modeText(b)}</b>
      <span class="small muted">${b.cases.length} round${b.cases.length === 1 ? '' : 's'}</span>
      <span class="battle-cost"><span class="chip-icon sm" aria-hidden="true"></span>${chipsText(b.cost)}</span>
    </div>
    ${caseRow(b.cases)}
    <div class="battle-seats">${sides.map((side) => side.map((i) => seat(b.seats[i], i)).join('')).join('<span class="vs">VS</span>')}</div>
    <div class="battle-card-actions">
      ${b.started ? `<button type="button" class="btn" data-battle-watch="${b.id}">${battleNow(b) >= b.cases.length * b.roundMs ? 'See how it went' : 'Watch'}</button>`
        : mine ? '<button type="button" class="btn secondary" data-battle-leave>Cancel battle</button>'
        : inIt ? '<button type="button" class="btn secondary" data-battle-leave>Leave</button>' : ''}
    </div>
  </div>`;
}

// ---- making one

function openBattleMaker() {
  const d = battles.draft;
  const rounds = () => Object.values(d.cases).reduce((n, k) => n + k, 0);
  const cost = () => casino.data.cases.reduce((n, c) => n + c.price * (d.cases[c.id] ?? 0), 0);
  modal(`<h2>Create a case battle</h2>
    <div class="battle-make">
      <div class="seg-row" role="group" aria-label="Mode">
        <button type="button" class="seg" data-make-mode="ffa">Free for all</button>
        <button type="button" class="seg" data-make-mode="2v2">2v2</button>
      </div>
      <div class="seg-row" id="make-players" role="group" aria-label="Players">
        ${[2, 3, 4].map((n) => `<button type="button" class="seg" data-make-players="${n}">${n} players</button>`).join('')}
      </div>
      <div class="make-cases">${casino.data.cases.map((c) => `
        <div class="make-case">
          ${caseArt(c)}
          <div><b>${escapeHtml(c.name)}</b><span class="small muted"><span class="chip-icon sm" aria-hidden="true"></span>${chipsText(c.price)}</span></div>
          <div class="stepper">
            <button type="button" class="icon-btn" data-make-less="${c.id}" aria-label="One fewer">−</button>
            <b data-make-n="${c.id}">0</b>
            <button type="button" class="icon-btn" data-make-more="${c.id}" aria-label="One more">+</button>
          </div>
        </div>`).join('')}
      </div>
      <p class="small muted" id="make-sum"></p>
    </div>
    <div class="modal-row">
      <button type="button" class="btn secondary" data-close>Not now</button>
      <button type="button" class="btn" id="make-go">Create</button>
    </div>`, 'battle-modal');
  const box = $('#modal');
  const draw = () => {
    box.querySelectorAll('[data-make-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.makeMode === d.mode)));
    box.querySelectorAll('[data-make-players]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.makePlayers) === d.players)));
    $('#make-players').classList.toggle('hidden', d.mode === '2v2');
    for (const c of casino.data.cases) box.querySelector(`[data-make-n="${c.id}"]`).textContent = d.cases[c.id] ?? 0;
    const n = rounds();
    $('#make-sum').innerHTML = n
      ? `${n} round${n === 1 ? '' : 's'} · everyone pays <b><span class="chip-icon sm" aria-hidden="true"></span>${chipsText(cost())}</b> to play (up to ${BATTLE_MAX_ROUNDS} cases)`
      : `Add up to ${BATTLE_MAX_ROUNDS} cases.`;
    $('#make-go').disabled = !n;
  };
  box.onclick = async (e) => {
    const t = e.target;
    const mode = t.closest('[data-make-mode]');
    if (mode) { d.mode = mode.dataset.makeMode; return draw(); }
    const players = t.closest('[data-make-players]');
    if (players) { d.players = Number(players.dataset.makePlayers); return draw(); }
    const more = t.closest('[data-make-more]');
    if (more && rounds() < BATTLE_MAX_ROUNDS) { d.cases[more.dataset.makeMore] = (d.cases[more.dataset.makeMore] ?? 0) + 1; return draw(); }
    const less = t.closest('[data-make-less]');
    if (less && d.cases[less.dataset.makeLess]) { d.cases[less.dataset.makeLess]--; return draw(); }
    if (t.closest('#make-go')) {
      const cases = casino.data.cases.flatMap((c) => Array(d.cases[c.id] ?? 0).fill(c.id));
      try {
        await api(`/api/channels/${casino.channelId}/battles`, { method: 'POST', body: { mode: d.mode, players: d.players, cases } });
        closeModal();
      } catch (err) {
        toast(err.message);
      }
    }
  };
  if (!rounds()) d.cases[casino.data.cases[0].id] = 1;
  draw();
}

async function battleAction(id, body) {
  try {
    await api(`/api/channels/${casino.channelId}/battles/${id}`, { method: 'POST', body });
  } catch (err) {
    toast(err.message);
  }
}

function onBattlesClick(e) {
  const t = e.target;
  if (t.closest('[data-battle-new]')) return openBattleMaker();
  const card = t.closest('[data-battle]');
  const id = Number(card?.dataset.battle);
  const join = t.closest('[data-battle-join]');
  if (join) return battleAction(id, { action: 'join', seat: Number(join.dataset.battleJoin) });
  const bot = t.closest('[data-battle-bot]');
  if (bot) return battleAction(id, { action: 'bot', seat: Number(bot.dataset.battleBot) });
  const kick = t.closest('[data-battle-kick]');
  if (kick) return battleAction(id, { action: 'kick', seat: Number(kick.dataset.battleKick) });
  if (t.closest('[data-battle-leave]')) return battleAction(id, { action: 'leave' });
  const watch = t.closest('[data-battle-watch]');
  if (watch) { battles.watching = Number(watch.dataset.battleWatch); return renderBattles(); }
  if (t.closest('[data-battle-back]')) { battles.watching = null; return renderBattles(); }
  if (t.closest('[data-battle-brag]')) return brag(t.closest('[data-battle-brag]').dataset.battleBrag);
}

// ---- watching one, round by round

const SPIN_SHARE = 0.72; // of each round, the reels spin; then it shows what landed

function stopBattle() {
  for (const id of battles.playing?.timers ?? []) clearTimeout(id);
  battles.playing = null;
}

/** Shows the battle where it is now, and keeps it going until it's done. */
function playBattle(b) {
  if (battles.playing?.id === b.id) return;
  stopBattle();
  battles.playing = { id: b.id, timers: [] };
  const later = (fn, ms) => battles.playing.timers.push(setTimeout(fn, Math.max(0, ms)));
  const now = battleNow(b);
  const round = Math.floor(now / b.roundMs);
  drawBattle(b, Math.min(round, b.cases.length));
  for (let r = round; r < b.cases.length; r++) {
    const into = r === round ? now - r * b.roundMs : 0;
    later(() => spinRound(b, r, into), r * b.roundMs - now + into);
    later(() => drawBattle(b, r + 1), (r + 1) * b.roundMs - now);
  }
}

function drawBattle(b, shown) {
  const main = $('#battles-main');
  if (!main) return;
  const done = shown >= b.cases.length;
  const totals = b.seats.map((s) => s.rolls.slice(0, shown).reduce((n, r) => n + r.value, 0));
  const sides = b.mode === '2v2' ? [[0, 1], [2, 3]] : b.seats.map((_, i) => [i]);
  const iWon = done && b.winners.some((i) => b.seats[i].userId === state.me.id);
  const myWin = Object.entries(b.won).find(([i]) => b.seats[i].userId === state.me.id)?.[1] ?? 0;
  const pot = b.seats.reduce((n, s) => n + s.rolls.reduce((m, r) => m + r.value, 0), 0);
  const column = (i) => {
    const s = b.seats[i];
    const last = shown > 0 ? s.rolls[shown - 1] : null;
    const won = done && b.winners.includes(i);
    return `<div class="b-col ${done ? (won ? 'won' : 'lost') : ''}" data-col="${i}">
      <div class="b-who">${s.bot ? '<span class="bot-face" aria-hidden="true">🤖</span>' : `<span class="avatar b-av" data-avatar="${s.userId}"></span>`}<b>${escapeHtml(seatName(s))}</b></div>
      <div class="b-total"><span class="chip-icon sm" aria-hidden="true"></span>${chipsText(totals[i])}</div>
      <div class="vreel"><div class="vstrip">${last ? itemTile(skinById(last.skinId), floatLine(last.float), { float: last.float }) : ''}</div><span class="vmarker" aria-hidden="true"></span></div>
      ${done ? `<div class="b-result">${won ? (s.bot ? 'Winner' : `Won ${chipsText(b.won[i] ?? 0)}`) : 'Lost'}</div>` : ''}
      <div class="b-items">${s.rolls.slice(0, shown).map((r) => `<div class="b-item r-${skinById(r.skinId).rarity}" style="--rarity:${RARITY[skinById(r.skinId).rarity].color}" title="${escapeHtml(`${skinTitle(skinById(r.skinId), r.stattrak)} · ${r.float.toFixed(14)}`)}">${skinArt(skinById(r.skinId), r.float)}<span>${chipsText(r.value)}</span></div>`).reverse().join('')}</div>
    </div>`;
  };
  main.innerHTML = `
    <div class="battle-view">
      <div class="case-head">
        <button type="button" class="icon-btn" data-battle-back aria-label="All battles"><svg viewBox="0 0 24 24"><path d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12l6.6-6.6Z"/></svg></button>
        <h3>${modeText(b)}</h3>
        <span class="small muted">${done ? 'Done' : `Round ${Math.min(shown + 1, b.cases.length)} of ${b.cases.length}`} · pot <span class="chip-icon sm" aria-hidden="true"></span>${chipsText(done ? pot : totals.reduce((n, t) => n + t, 0))}</span>
      </div>
      <div class="battle-rounds">${b.cases.map((id, r) => `<span class="battle-case ${r < shown ? 'past' : r === shown && !done ? 'now' : ''}">${caseArt(battleBox(id))}</span>`).join('')}</div>
      <div class="b-cols n${b.seats.length} ${b.mode}">${sides.map((side) => `<div class="b-side">${side.map(column).join('')}</div>`).join('<span class="vs">VS</span>')}</div>
      ${done ? `<div class="battle-end">
        <b>${iWon ? `You won ${chipsText(myWin)} worth of skins. They're in your inventory.` : b.winners.every((i) => b.seats[i].bot) ? 'The bots won this one. Their skins are gone.' : `${b.winners.filter((i) => !b.seats[i].bot).map((i) => escapeHtml(seatName(b.seats[i]))).join(' and ')} won it all.`}</b>
        ${iWon ? `<button type="button" class="btn secondary" data-battle-brag="${escapeHtml(`⚔️ Won a case battle (${modeText(b)}) worth ${chipsText(myWin)} chips`)}">Show the fire</button>` : ''}
      </div>` : ''}
    </div>`;
  drawAvatars(main);
}

/** Round r: every column's reel spins down to what that player opened. */
function spinRound(b, r, into) {
  const main = $('#battles-main');
  if (!main || battles.playing?.id !== b.id) return;
  const box = battleBox(b.cases[r]);
  const ms = b.roundMs * SPIN_SHARE - into;
  const WIN_AT = 22;
  let best = null;
  main.querySelectorAll('.b-col').forEach((col) => {
    const roll = b.seats[Number(col.dataset.col)].rolls[r];
    const skin = skinById(roll.skinId);
    if (!best || RARITY_ORDER.indexOf(skin.rarity) < RARITY_ORDER.indexOf(best.rarity)) best = skin;
    const reel = col.querySelector('.vreel');
    const strip = col.querySelector('.vstrip');
    const items = Array.from({ length: WIN_AT + 3 }, (_, k) => (k === WIN_AT ? skin : fillerSkin(box)));
    strip.innerHTML = items.map((s, k) => itemTile(s, '', k === WIN_AT ? { float: roll.float } : { star: true })).join('');
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0)';
    const tile = strip.firstElementChild;
    const step = tile.offsetHeight + parseFloat(getComputedStyle(strip).rowGap || '6');
    const land = WIN_AT * step + tile.offsetHeight * (0.25 + Math.random() * 0.5) - reel.clientHeight / 2;
    strip.getBoundingClientRect();
    if (ms <= 200) {
      strip.style.transform = `translateY(${-land}px)`;
      return;
    }
    strip.style.transition = `transform ${ms}ms cubic-bezier(.1,.65,.15,1)`;
    strip.style.transform = `translateY(${-land}px)`;
  });
  if (ms > 200 && best && ['covert', 'rare'].includes(best.rarity)) battles.playing.timers.push(setTimeout(() => playSound('message'), ms));
}
