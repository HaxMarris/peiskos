// The year at the fire: a hearth's year as a deck of cards, read alone or swiped through together
// at a fire (anyone sitting there moves it for everyone), and a page to print. The cards that start
// with "you-" show each person their own numbers. Numbers come from /api/servers/:id/recap/:year.
//
// Cards go by id, not by place: a card with nothing to show is left out of someone's deck, so the
// same place can be a different card for two people.

/** The sky behind each card runs through one night, from dusk to first light. */
const RECAP_SKIES = ['dusk', 'dusk', 'night', 'night', 'night', 'deep', 'deep', 'deep', 'embers', 'embers', 'embers', 'embers', 'dawn'];
const RECAP_CARDS = ['open', 'fire', 'keepers', 'you-fire', 'rooms', 'talk', 'reactions', 'loved', 'you-words', 'fish', 'casino', 'you-play', 'end'];
const recapState = { serverId: 0, year: 0, data: null, deck: [], at: 0, together: false, channelId: 0, seenShow: 0 };

const recapNum = (x) => Number(x).toLocaleString();
const recapCount = (n, one, many = `${one}s`) => `${recapNum(n)} ${n === 1 ? one : many}`;
const recapHours = (h) => (h < 1 ? `${Math.round(h * 60)} min` : `${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : recapNum(Math.round(h))} h`);
const recapDay = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
const recapMonth = (m) => new Date(Date.UTC(2000, m - 1, 15)).toLocaleDateString(undefined, { month: 'long' });
const recapNth = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
/** ", more than anyone here" or ", the 3rd most here" (with nobody else to compare, nothing). */
const recapRank = (rank) => (!rank ? '' : rank === 1 ? ', more than anyone here' : `, the ${recapNth(rank)} most here`);
const recapStars = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
const recapList = (items, line) => `<ol class="recap-list">${items.map((x) => `<li>${line(x)}</li>`).join('')}</ol>`;
const recapCatch = (c) => `${escapeHtml(c.fish)}${c.giant ? ' (giant)' : ''}, ${c.size < 20 ? c.size.toFixed(1) : Math.round(c.size)} cm <span class="recap-stars" aria-label="${c.stars} stars">${recapStars(c.stars)}</span>`;
const recapSkin = (k) => `${escapeHtml(k.stattrak ? `StatTrak ${k.skin}` : k.skin)}, worth ${recapNum(k.value)} chips`;

/** Each card's inside, or null when there's nothing to put on it. `big` is the one figure the card is about. */
const RECAP_RENDER = {
  open: (r) => `<p class="recap-small">${escapeHtml(r.hearth)}</p>
    <p class="recap-big">${r.year}</p><p class="recap-lead">at the fire</p>
    <dl class="recap-facts">
      <div><dt>messages</dt><dd>${recapNum(r.messages)}</dd></div>
      <div><dt>around the fire</dt><dd>${recapHours(r.fire.hours)}</dd></div>
      <div><dt>new here</dt><dd>${recapNum(r.newPeople)}</dd></div>
    </dl>`,
  fire: (r) => r.fire.hours < 0.05 ? null : `<p class="recap-small">Around the fire</p>
    <p class="recap-big">${recapHours(r.fire.hours)}</p>
    <p class="recap-lead">over ${recapNum(r.fire.nights)} ${r.fire.nights === 1 ? 'night' : 'nights'}</p>
    ${r.fire.longest ? `<p>The longest night was ${escapeHtml(recapDay(r.fire.longest.day))}: the fire stayed lit for ${recapHours(r.fire.longest.hours)}${r.fire.longest.people > 1 ? ` and ${r.fire.longest.people} people came by` : ''}.</p>` : ''}
    ${r.fire.mostAtOnce?.n > 1 ? `<p>${r.fire.mostAtOnce.n} people sat down at once on ${escapeHtml(recapDay(r.fire.mostAtOnce.day))}.</p>` : ''}`,
  keepers: (r) => r.topFire.length < 2 ? null : `<p class="recap-small">Most hours at the fire</p>
    ${recapList(r.topFire, (x) => `<span>${escapeHtml(x.name)}</span><b>${recapHours(x.hours)}</b>`)}`,
  'you-fire': (r) => r.you.fireHours < 0.05 ? null : `<p class="recap-small">You at the fire</p>
    <p class="recap-big">${recapHours(r.you.fireHours)}</p>
    <p class="recap-lead">over ${recapNum(r.you.fireNights)} ${r.you.fireNights === 1 ? 'night' : 'nights'}${recapRank(r.you.fireRank)}</p>
    ${r.you.satWith ? `<p>You sat with ${escapeHtml(r.you.satWith.name)} the most: ${recapHours(r.you.satWith.hours)} together.</p>` : ''}`,
  rooms: (r) => !r.topRooms.length ? null : `<p class="recap-small">Where the talking happened</p>
    ${recapList(r.topRooms, (x) => `<span>#${escapeHtml(x.name)}</span><b>${recapNum(x.messages)}</b>`)}
    ${r.busiestDay ? `<p>The busiest day was ${escapeHtml(recapDay(r.busiestDay.day))}, with ${recapCount(r.busiestDay.n, 'message')}${r.busiestMonth ? `. The busiest month was ${escapeHtml(recapMonth(r.busiestMonth.month))}` : ''}.</p>` : ''}`,
  talk: (r) => r.topPeople.length < 2 ? null : `<p class="recap-small">Most messages</p>
    ${recapList(r.topPeople, (x) => `<span>${escapeHtml(x.name)}</span><b>${recapNum(x.n)}</b>`)}`,
  reactions: (r) => !r.topReactions.length ? null : `<p class="recap-small">Favourite reactions</p>
    <p class="recap-big recap-emoji">${emojiHtml(r.topReactions[0].emoji)}</p>
    <p class="recap-lead">${recapCount(r.topReactions[0].n, 'time')}</p>
    <div class="recap-emoji-row">${r.topReactions.slice(1).map((x) => `<span>${emojiHtml(x.emoji)}<small>${recapNum(x.n)}</small></span>`).join('')}</div>`,
  loved: (r) => !r.mostLoved ? null : `<p class="recap-small">Most reactions on one message</p>
    <blockquote class="recap-quote">${escapeHtml(r.mostLoved.content)}</blockquote>
    <p>${escapeHtml(r.mostLoved.author)}, with ${recapCount(r.mostLoved.reactions, 'reaction')}</p>`,
  'you-words': (r) => !r.you.messages && !r.you.reactions ? null : `<p class="recap-small">You in the rooms</p>
    <p class="recap-big">${recapNum(r.you.messages)}</p>
    <p class="recap-lead">${r.you.messages === 1 ? 'message' : 'messages'}${recapRank(r.you.talkRank)}</p>
    ${r.you.topRoom ? `<p>Most of them in #${escapeHtml(r.you.topRoom)}.</p>` : ''}
    <p>${recapCount(r.you.reactionsGot, 'reaction')} on yours. You reacted ${recapCount(r.you.reactions, 'time')}${r.you.emoji ? `, mostly with ${emojiHtml(r.you.emoji.emoji)}` : ''}.</p>
    ${r.you.firstWords ? `<p class="recap-first">Your first message of the year: <q>${escapeHtml(r.you.firstWords.content)}</q></p>` : ''}`,
  fish: (r) => !r.fish.days ? null : `<p class="recap-small">Fireside Angler</p>
    ${r.fish.best ? `<p class="recap-lead">Best catch of the year</p><p class="recap-mid">${recapCatch(r.fish.best)}</p><p>Landed by ${escapeHtml(r.fish.best.name)}.</p>` : ''}
    <p>${recapNum(r.fish.anglers)} ${r.fish.anglers === 1 ? 'person' : 'people'} fished on ${recapCount(r.fish.days, 'day')} between them${r.fish.topAngler && r.fish.anglers > 1 ? `, ${escapeHtml(r.fish.topAngler.name)} most often` : ''}.</p>
    ${r.fish.derbyChamp ? `<p>${escapeHtml(r.fish.derbyChamp.name)} won the most derbies: ${recapNum(r.fish.derbyChamp.wins)}.</p>` : ''}`,
  casino: (r) => !r.casino.found && !r.casino.best ? null : `<p class="recap-small">The casino</p>
    <p class="recap-big">${recapNum(r.casino.found)}</p><p class="recap-lead">new skins in the book</p>
    ${r.casino.best ? `<p>Best pull still kept: ${escapeHtml(r.casino.best.name)}'s ${recapSkin(r.casino.best)}.</p>` : ''}
    ${r.casino.chipLeader ? `<p>Most chips right now: ${escapeHtml(r.casino.chipLeader.name)}, with ${recapNum(r.casino.chipLeader.chips)}.</p>` : ''}`,
  'you-play': (r) => !r.you.fishDays && !r.you.found && !r.you.bestSkin ? null : `<p class="recap-small">You at play</p>
    ${r.you.fishDays ? `<p class="recap-lead">${recapNum(r.you.fishDays)} ${r.you.fishDays === 1 ? 'day' : 'days'} fishing</p>` : ''}
    ${r.you.bestCatch ? `<p>Your best catch: ${recapCatch(r.you.bestCatch)}.</p>` : ''}
    ${r.you.derbyWins ? `<p>You won ${r.you.derbyWins === 1 ? 'a derby' : `${recapNum(r.you.derbyWins)} derbies`}.</p>` : ''}
    ${r.you.found ? `<p class="recap-lead">${recapNum(r.you.found)} new ${r.you.found === 1 ? 'skin' : 'skins'} in your book</p>` : ''}
    ${r.you.bestSkin ? `<p>Your best: ${recapSkin(r.you.bestSkin)}.</p>` : ''}
    ${r.you.chips !== null ? `<p>You have ${recapCount(r.you.chips, 'chip')}.</p>` : ''}`,
  end: (r) => `<p class="recap-small">${escapeHtml(r.hearth)}</p>
    <p class="recap-big">${r.year}</p><p class="recap-lead">That was the year.</p>
    <div class="recap-end-actions">
      <button type="button" class="btn secondary" data-recap="restart">Start again</button>
      ${recapCanPrint() ? '<button type="button" class="btn secondary" data-recap="print">Print</button>' : ''}
    </div>`,
};

// The phone apps' web views have no print dialog.
const recapCanPrint = () => !isPhoneApp && typeof window.print === 'function';

/** The fire you're at, when it belongs to this hearth. */
const recapFireHere = (serverId) => (state.voice && fireServer()?.id === serverId ? state.voice.channelId : 0);

/** The year to look back on: last year's until the end of January, then this one. */
const recapYear = () => (new Date().getMonth() === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear());

async function openRecap(serverId, year = recapYear(), { card = 'open', together = false } = {}) {
  const s = state.servers.get(serverId);
  if (!s) return;
  let r;
  try { r = await api(`/api/servers/${serverId}/recap/${year}`); } catch (err) { return alertError(err); }
  r.hearth ??= s.name;
  Object.assign(recapState, { serverId, year, data: r, together: together && !!recapFireHere(serverId), channelId: recapFireHere(serverId) });
  recapState.deck = RECAP_CARDS.filter((id) => RECAP_RENDER[id](r) !== null);
  recapState.at = 0;
  recapBuild();
  recapGo(card, false);
}

function recapBuild() {
  let box = $('#recap');
  if (!box) {
    box = document.createElement('div');
    box.id = 'recap';
    box.className = 'recap';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    document.body.append(box);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); recapStep(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); recapStep(-1); }
      else if (e.key === 'Escape') { e.stopPropagation(); closeRecap(); }
    });
    // Swiping: a mostly sideways drag of 50px or more turns the card.
    let from = null;
    box.addEventListener('pointerdown', (e) => { if (e.target.closest('.recap-card')) from = { x: e.clientX, y: e.clientY }; });
    box.addEventListener('pointerup', (e) => {
      if (!from) return;
      const dx = e.clientX - from.x, dy = e.clientY - from.y;
      from = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) recapStep(dx < 0 ? 1 : -1);
    });
    box.addEventListener('pointercancel', () => (from = null));
  }
  const r = recapState.data;
  box.setAttribute('aria-label', `${r.hearth}, ${r.year} at the fire`);
  const fireHere = !!recapState.channelId;
  box.innerHTML = `<div class="recap-top">
      ${r.years.length > 1 ? `<select id="recap-year" aria-label="Year">${r.years.map((y) => `<option ${y === r.year ? 'selected' : ''}>${y}</option>`).join('')}</select>` : `<span class="recap-small">${r.year}</span>`}
      <span class="recap-together" id="recap-together-note"></span>
      ${fireHere ? `<button type="button" class="btn secondary" id="recap-share">${recapState.together ? 'Stop showing' : 'Show at the fire'}</button>` : ''}
      ${recapCanPrint() ? '<button type="button" class="btn secondary" data-recap="print">Print</button>' : ''}
      <button type="button" class="icon-btn recap-close" id="recap-close" title="Close" aria-label="Close">✕</button>
    </div>
    <div class="recap-stage">
      <button type="button" class="recap-turn" data-recap="back" aria-label="Previous card"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12l6.6-6.6Z"/></svg></button>
      <article class="recap-card" id="recap-card" aria-live="polite"></article>
      <button type="button" class="recap-turn" data-recap="next" aria-label="Next card"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.6 18.6 1.4 1.4 8-8-8-8-1.4 1.4 6.6 6.6-6.6 6.6Z"/></svg></button>
    </div>
    <div class="recap-dots" id="recap-dots" aria-hidden="true">${recapState.deck.map(() => '<span></span>').join('')}</div>`;
  box.onclick = (e) => {
    const act = e.target.closest('[data-recap]')?.dataset.recap;
    if (act === 'next') recapStep(1);
    else if (act === 'back') recapStep(-1);
    else if (act === 'restart') recapGo('open');
    else if (act === 'print') printRecap();
  };
  $('#recap-close').onclick = closeRecap;
  $('#recap-year')?.addEventListener('change', (e) => openRecap(recapState.serverId, Number(e.target.value), { together: recapState.together }).then(() => recapState.together && recapSend()));
  $('#recap-share')?.addEventListener('click', () => {
    if (recapState.together) {
      api('/api/voice/recap', { method: 'POST', body: { stop: true } }).catch(() => {});
      recapState.together = false;
    } else {
      recapState.together = true;
      recapSend();
    }
    recapBuild();
    recapGo(recapState.deck[recapState.at], false);
  });
  recapTogetherNote();
  box.classList.remove('hidden');
  if (!box.contains(document.activeElement)) box.querySelector('.recap-turn[data-recap="next"]').focus();
}

function recapTogetherNote() {
  const note = $('#recap-together-note');
  if (!note) return;
  const ch = roomById(recapState.channelId)?.c;
  const n = ch?.voiceUsers?.length ?? 0;
  note.textContent = recapState.together ? `Everyone at ${ch?.name ?? 'the fire'} sees this${n > 1 ? ` (${n} here)` : ''}` : '';
}

/** Shows the card with this id, or the next one in the deck after where it would be. */
function recapGo(id, send = true) {
  const deck = recapState.deck;
  let at = deck.indexOf(id);
  if (at < 0) {
    const order = RECAP_CARDS.indexOf(id);
    at = deck.findIndex((d) => RECAP_CARDS.indexOf(d) > order);
    if (at < 0) at = deck.length - 1;
  }
  const forward = at >= recapState.at;
  recapState.at = at;
  const card = $('#recap-card');
  if (!card) return;
  const cardId = deck[at];
  card.dataset.sky = RECAP_SKIES[RECAP_CARDS.indexOf(cardId)];
  card.dataset.card = cardId;
  card.innerHTML = `<div class="recap-body">${RECAP_RENDER[cardId](recapState.data)}</div><div class="recap-horizon" aria-hidden="true"><span class="recap-ember" style="--burn:${(at / Math.max(1, deck.length - 1)).toFixed(2)}"></span></div>`;
  card.classList.remove('turn-in', 'turn-back');
  void card.offsetWidth;
  card.classList.add(forward ? 'turn-in' : 'turn-back');
  $('#recap-dots').querySelectorAll('span').forEach((d, i) => d.classList.toggle('on', i === at));
  $('#recap').querySelector('[data-recap="back"]').disabled = at === 0;
  $('#recap').querySelector('[data-recap="next"]').disabled = at === deck.length - 1;
  if (send && recapState.together) recapSend();
}
const recapStep = (d) => {
  const at = recapState.at + d;
  if (at >= 0 && at < recapState.deck.length) recapGo(recapState.deck[at]);
};
const recapSend = () =>
  api('/api/voice/recap', { method: 'POST', body: { year: recapState.year, card: recapState.deck[recapState.at] } }).catch((err) => toast(err.message, { kind: 'error' }));

function closeRecap() {
  const box = $('#recap');
  if (!box) return;
  box.remove();
  // Closing it yourself only stops you watching; the others carry on.
  recapState.together = false;
}

/** Someone at your fire moved the recap, started it or stopped it. */
function onRecapShow(ev) {
  if (!state.voice || ev.channelId !== state.voice.channelId) return;
  const open = !!$('#recap');
  if (ev.stop) {
    if (open && recapState.together) {
      recapState.together = false;
      recapBuild();
      recapGo(recapState.deck[recapState.at], false);
    }
    return;
  }
  if (ev.by === state.me.id) return;
  if (open && recapState.together && recapState.serverId === ev.serverId) {
    if (recapState.year !== ev.year) return openRecap(ev.serverId, ev.year, { card: ev.card, together: true });
    return recapGo(ev.card, false);
  }
  // One offer per show, not one for every card turned.
  if (open || recapState.seenShow === ev.channelId) return;
  recapState.seenShow = ev.channelId;
  const s = state.servers.get(ev.serverId);
  const who = s?.members?.find((m) => m.id === ev.by);
  toast(`${nameOfPerson(who)} is showing ${s?.name ?? 'the hearth'}'s ${ev.year} at the fire.`, {
    action: 'Watch',
    timeout: 15000,
    onAction: () => openRecap(ev.serverId, ev.year, { card: ev.card, together: true }),
  });
}

/** Sitting down at a fire where a recap is already being shown. */
async function recapCatchUp(channelId) {
  if (recapState.seenShow === channelId) return;
  let r;
  try { r = await api('/api/voice/recap'); } catch { return; }
  if (r.show && state.voice?.channelId === channelId) onRecapShow({ type: 'recap', channelId, ...r.show, by: r.show.by === state.me.id ? -1 : r.show.by });
}
// Leaving a fire forgets the show you were offered there.
let recapFireLast = 0;
function recapVoiceState(ev) {
  if ($('#recap')) recapTogetherNote();
  const here = state.voice?.channelId ?? 0;
  if (here === recapFireLast) return;
  recapFireLast = here;
  recapState.seenShow = 0;
  if (here && ev.channelId === here && ev.userIds.includes(state.me.id)) recapCatchUp(here);
}

/** Every card on one page, for printing. */
function printRecap() {
  const r = recapState.data;
  if (!r) return;
  $('#recap-print')?.remove();
  const page = document.createElement('div');
  page.id = 'recap-print';
  page.className = 'recap-print';
  page.innerHTML = `<header><h1>${escapeHtml(r.hearth)}: ${r.year} at the fire</h1><p>For ${escapeHtml(nameOfPerson(state.me))}</p></header>
    <div class="recap-print-grid">${recapState.deck.filter((id) => id !== 'end').map((id) => `<section data-card="${id}">${RECAP_RENDER[id](r)}</section>`).join('')}</div>`;
  document.body.append(page);
  document.body.classList.add('printing-recap');
  const done = () => { document.body.classList.remove('printing-recap'); page.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}
