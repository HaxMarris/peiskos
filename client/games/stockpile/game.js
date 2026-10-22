/* ============================================================
   STOCKPILE — a card game for two to eight friends at a Peiskos fire.
   Build the shared piles from 1 to 12; first to empty their stockpile wins.
   Peiskos frames this page and passes the players' messages through its
   own server. Whoever started the game is the host: their copy holds the
   deck and everyone's cards, checks each move, and sends every player
   only what they're allowed to see.
   ============================================================ */

(function(){

function $(id){ return document.getElementById(id); }
function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}
function shortName(name){ return String(name||'Player').slice(0,16); }
function shuffle(a){
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

const WILD = 0;         // any other card is its number, 1 to 12
const HAND = 5;
const BUILDS = 4;
const DISCARDS = 4;
const MAX_PLAYERS = 8;
const DECK = 162;       // 12 of each number and 18 wilds

function toPeiskos(msg){ window.parent.postMessage(msg, '*'); }

let me = null;          // {id, name}
let hostUid = null;
let isHost = false;
let view = null;        // what the host last said this player can see
let picked = null;      // {src:'hand'|'stock'|'discard', i, c} the card you've picked up

// ================================================================
// HOST — the whole game lives here
// ================================================================
let present = [];       // [{id, name}] everyone in the game right now, in the order they joined
let G = null;           // the round: {seats, draw, builds, done, turn, stockSize, winner, log, round}
let phase = 'lobby';    // lobby | play | over
let stockSetting = 'auto';
let round = 0;

function makeDeck(decks){
  const d = [];
  for(let k=0;k<decks;k++){
    for(let n=1;n<=12;n++) for(let i=0;i<12;i++) d.push(n);
    for(let i=0;i<18;i++) d.push(WILD);
  }
  return shuffle(d);
}

function stockSizeFor(n){
  if(stockSetting !== 'auto') return Number(stockSetting);
  return n >= 5 ? 20 : 30;
}

function deal(){
  const players = present.slice(0, MAX_PLAYERS);
  const stockSize = stockSizeFor(players.length);
  // Enough decks that the draw pile doesn't run dry with lots of players.
  const decks = Math.max(1, Math.ceil((players.length * (stockSize + HAND) + 60) / DECK));
  const draw = makeDeck(decks);
  const seats = players.map(p=>({ uid:p.id, name:p.name, stock:draw.splice(0, stockSize), hand:[], discards:[[],[],[],[]] }));
  round++;
  G = { seats, draw, builds:[[],[],[],[]], done:[], turn: Math.floor(Math.random()*seats.length), stockSize, winner:null, log:'', round, lastPile:-1 };
  phase = 'play';
  startTurn();
  G.log = G.seats[G.turn].name + ' goes first';
}

function drawCard(){
  if(!G.draw.length && G.done.length){
    G.draw = shuffle(G.done);
    G.done = [];
  }
  return G.draw.length ? G.draw.pop() : null;
}

function sortHand(h){ h.sort((a,b)=> (a||99) - (b||99)); }

function refill(seat){
  while(seat.hand.length < HAND){
    const c = drawCard();
    if(c === null) break;
    seat.hand.push(c);
  }
  sortHand(seat.hand);
}

function startTurn(){ refill(G.seats[G.turn]); }

function nextTurn(){
  G.turn = (G.turn + 1) % G.seats.length;
  startTurn();
}

function canPlay(card, pile){
  return card === WILD || card === pile.length + 1;
}

/** A move from a player (the host's own moves come here too). Anything that doesn't fit is ignored. */
function act(uid, a){
  if(phase !== 'play' || !a || typeof a !== 'object') return;
  const seat = G.seats[G.turn];
  if(!seat || seat.uid !== uid) return;
  if(a.type === 'play'){
    const pi = a.pile|0;
    if(pi < 0 || pi >= BUILDS) return;
    let from;
    if(a.src === 'hand') from = seat.hand;
    else if(a.src === 'stock') from = seat.stock;
    else if(a.src === 'discard') from = seat.discards[a.i|0];
    if(!from || !from.length) return;
    const idx = a.src === 'hand' ? (a.i|0) : from.length - 1;
    const card = from[idx];
    if(card === undefined || card !== a.c) return;   // they acted on a stale view
    const pile = G.builds[pi];
    if(!canPlay(card, pile)) return;
    from.splice(idx, 1);
    pile.push(card);
    const value = pile.length;
    G.lastPile = pi;
    G.log = seat.name + ' played ' + (card === WILD ? 'a wild as ' + value : value) + (a.src === 'stock' ? ' from their stockpile' : '');
    if(value === 12){
      G.done.push(...pile);
      G.builds[pi] = [];
      G.log += ' and finished a pile';
    }
    if(a.src === 'stock' && !seat.stock.length){
      G.winner = seat.uid;
      G.log = seat.name + ' emptied their stockpile';
      phase = 'over';
    } else if(a.src === 'hand' && !seat.hand.length){
      refill(seat);
    }
  } else if(a.type === 'discard'){
    const i = a.i|0, pi = a.pile|0;
    if(pi < 0 || pi >= DISCARDS || seat.hand[i] === undefined || seat.hand[i] !== a.c) return;
    seat.discards[pi].push(seat.hand.splice(i, 1)[0]);
    G.lastPile = -1;
    G.log = seat.name + ' discarded';
    nextTurn();
  } else if(a.type === 'pass'){
    if(seat.hand.length) return;   // only when there's nothing left to discard
    G.lastPile = -1;
    G.log = seat.name + ' had no cards left';
    nextTurn();
  } else return;
  publish();
}

/** What one person may see: everyone's piles, but only their own hand. */
function viewFor(uid){
  const seats = G ? G.seats.map(s=>({
    uid:s.uid, name:s.name, stock:s.stock.length, top: s.stock.length ? s.stock[s.stock.length-1] : null,
    discards:s.discards, hand:s.hand.length,
  })) : [];
  const mine = G && G.seats.find(s=>s.uid===uid);
  return {
    type:'view', phase, round,
    present: present.map(p=>({id:p.id, name:p.name})),
    stockSetting,
    seats,
    builds: G ? G.builds.map(b=>({n:b.length, wild: b.length ? b[b.length-1]===WILD : false})) : [],
    draw: G ? G.draw.length + G.done.length : 0,
    turn: G && G.seats[G.turn] ? G.seats[G.turn].uid : null,
    winner: G ? G.winner : null,
    log: G ? G.log : '',
    lastPile: G ? G.lastPile : -1,
    hand: mine ? mine.hand : null,
  };
}

function publish(){
  for(const p of present){
    if(p.id === me.id) continue;
    toPeiskos({kind:'send', to:p.id, data:viewFor(p.id)});
  }
  show(viewFor(me.id));
}

// Peiskos says who's in the game now.
function syncPlayers(players){
  const before = new Set(present.map(p=>p.id));
  present = players.map(p=>({id:p.id, name:shortName(p.name)}));
  const now = new Set(present.map(p=>p.id));
  if(phase === 'play' && G){
    // Anyone who left is out of the round, and their cards go with them.
    const turnUid = G.seats[G.turn] && G.seats[G.turn].uid;
    const gone = G.seats.filter(s=>!now.has(s.uid));
    if(gone.length){
      G.seats = G.seats.filter(s=>now.has(s.uid));
      G.log = gone.map(s=>s.name).join(', ') + ' left';
      if(G.seats.length < 2){
        G.winner = G.seats[0] ? G.seats[0].uid : null;
        phase = 'over';
      } else {
        const keep = G.seats.findIndex(s=>s.uid===turnUid);
        if(keep >= 0) G.turn = keep;
        else { G.turn = G.turn % G.seats.length; startTurn(); }
      }
    }
  }
  const joined = present.filter(p=>!before.has(p.id) && p.id !== me.id);
  if(joined.length) showToast(joined.map(p=>p.name).join(', ') + ' joined');
  publish();
}

// ================================================================
// EVERYONE — drawing the table
// ================================================================
function showScreen(name){
  for(const id of ['loadingScreen','lobbyScreen','table']) $(id).classList.toggle('hidden', id !== name);
}

function showToast(msg){
  document.querySelectorAll('.toast').forEach(t=> t.remove());   // one at a time, so they don't pile up
  const t = el('div', 'toast', msg);
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), 2600);
}

function cardEl(c, extra){
  const e = el('div', 'card ' + (c === WILD ? 'wild' : c <= 4 ? 'c-lo' : c <= 8 ? 'c-mid' : 'c-hi') + (extra ? ' ' + extra : ''));
  e.appendChild(el('span', 'num', c === WILD ? '★' : String(c)));
  if(c === WILD) e.appendChild(el('span', 'tag', 'WILD'));
  return e;
}

function show(v){
  const prevTurn = view && view.turn;
  const before = view && view.phase === 'play' ? view.seats : [];
  view = v;
  if(v.phase === 'lobby'){ picked = null; closePeek(); renderLobby(); showScreen('lobbyScreen'); return; }
  if(!pickedStillThere()) picked = null;
  showScreen('table');
  renderTable();
  if(v.phase === 'play' && v.turn === me.id && prevTurn !== me.id) showToast('Your turn');
  // Someone just got down to the last card of their stockpile.
  if(v.phase === 'play') for(const s of v.seats){
    const was = before.find(b=>b.uid===s.uid);
    if(s.stock === 1 && was && was.stock > 1) showToast(s.uid === me.id ? "You're on your last card!" : s.name + ' is on their last card!');
  }
}

function renderLobby(){
  const v = view;
  const list = $('lobbyPlayers');
  list.replaceChildren();
  v.present.forEach((p, i)=>{
    const row = el('div', 'player-row');
    row.appendChild(el('span', 'dot p' + (i % 8)));
    row.appendChild(el('span', 'pname', p.name));
    if(p.id === hostUid) row.appendChild(el('span', 'tag-host', 'HOST'));
    else if(p.id === me.id) row.appendChild(el('span', 'tag-you', 'YOU'));
    if(i >= MAX_PLAYERS) row.appendChild(el('span', 'tag-you', 'WAITING'));
    list.appendChild(row);
  });
  $('stockRow').classList.toggle('hidden', !isHost);
  $('stockSelect').value = v.stockSetting;
  $('btnStart').classList.toggle('hidden', !isHost);
  $('btnStart').disabled = v.present.length < 2;
  $('lobbyStatus').textContent = isHost
    ? (v.present.length < 2 ? 'You need at least one more player. Friends at the fire can join from the Games card.' : '')
    : 'Waiting for the host to deal…';
}

function renderTable(){
  const v = view;
  const mySeat = v.seats.find(s=>s.uid===me.id);
  const myTurn = v.phase === 'play' && v.turn === me.id && !!mySeat;
  const turnSeat = v.seats.find(s=>s.uid===v.turn);

  $('turnBanner').textContent = v.phase === 'over' ? 'Round over'
    : myTurn ? 'Your turn' : turnSeat ? turnSeat.name + "'s turn" : '';
  $('turnBanner').classList.toggle('mine', myTurn);
  $('logLine').textContent = v.log;

  // Everyone else sits around the table, in turn order going clockwise from you:
  // up your left side, across the top, then down your right side.
  const at = Math.max(0, v.seats.findIndex(s=>s.uid===me.id));
  const others = v.seats.slice(at).concat(v.seats.slice(0, at)).filter(s=>s.uid!==me.id);
  const [onLeft, onTop, onRight] = seatsAround(others.length);
  const spots = [$('oppLeft'), $('oppTop'), $('oppRight')];
  spots.forEach(x=> x.replaceChildren());
  others.forEach((s, k)=>{
    const box = el('div', 'opp' + (s.uid===v.turn && v.phase==='play' ? ' turn' : ''));
    const head = el('div', 'opp-head');
    head.appendChild(el('span', 'dot p' + (v.seats.indexOf(s) % 8)));
    head.appendChild(el('span', 'pname', s.name));
    if(s.stock === 1) head.appendChild(el('span', 'last-badge', 'LAST CARD'));
    head.appendChild(el('span', 'opp-hand', '✋' + s.hand));
    box.appendChild(head);
    const row = el('div', 'opp-row');
    const stock = el('div', 'mini-col');
    stock.appendChild(s.top === null ? el('div', 'card mini empty') : cardEl(s.top, 'mini'));
    stock.appendChild(el('div', 'pile-label' + (s.stock === 1 ? ' last' : ''), s.stock === 1 ? 'last card' : s.stock + ' left'));
    row.appendChild(stock);
    const ds = el('div', 'opp-discards');
    s.discards.forEach((d, i)=>{
      const f = fan(d, 'mini');
      peekable(f, s.uid, i);
      f.onclick = (e)=>{ e.stopPropagation(); if(d.length > 1) (canHover ? openPeek : togglePeek)(s.uid, i, f); };
      ds.appendChild(f);
    });
    row.appendChild(ds);
    box.appendChild(row);
    if(k < onLeft) spots[0].prepend(box);   // the left side fills from the bottom up
    else if(k < onLeft + onTop) spots[1].appendChild(box);
    else spots[2].appendChild(box);
  });
  $('arena').classList.toggle('narrow', narrowTable());
  fitCards(onLeft + onRight > 0 ? 2 : 0, onTop);
  spots.forEach(x=> x.classList.toggle('hidden', !x.childElementCount));

  // The draw pile and the four building piles.
  $('drawCount').textContent = v.draw + ' to draw';
  const builds = $('builds');
  builds.replaceChildren();
  v.builds.forEach((b, i)=>{
    const col = el('div', 'pile-col');
    const target = !!(picked && myTurn && (picked.c === WILD || picked.c === b.n + 1));
    let card;
    if(b.n){
      card = cardEl(b.n, (b.wild ? 'as-wild ' : '') + (target ? 'target' : '') + (i === v.lastPile ? ' fresh' : ''));
      if(b.wild) card.appendChild(el('span', 'tag', 'WILD'));
    } else {
      card = el('div', 'card empty' + (target ? ' target' : ''));
      card.appendChild(el('span', 'hint-num', '1'));
    }
    card.onclick = ()=> playTo(i);
    col.appendChild(card);
    col.appendChild(el('div', 'pile-label', b.n ? 'next: ' + (b.n === 12 ? '—' : b.n + 1) : 'start with 1'));
    builds.appendChild(col);
  });

  // Your stockpile, discard piles and hand.
  $('mine').classList.toggle('spectating', !mySeat);
  $('mine').classList.toggle('turn', myTurn);
  const stock = $('myStock');
  stock.replaceChildren();
  if(mySeat){
    if(mySeat.top !== null){
      const c = cardEl(mySeat.top, pickedIs('stock', 0) ? 'picked' : '');
      c.onclick = ()=> pick('stock', 0, mySeat.top);
      stock.appendChild(c);
    } else stock.appendChild(el('div', 'card empty'));
    $('myStockCount').textContent = mySeat.stock === 1 ? 'Last card in your stockpile!' : mySeat.stock + ' in your stockpile';
    $('myStockCount').classList.toggle('last', mySeat.stock === 1);
    $('myStock').classList.toggle('last', mySeat.stock === 1);
  } else {
    $('myStockCount').textContent = '';
    $('myStockCount').classList.remove('last');
    $('myStock').classList.remove('last');
  }
  const md = $('myDiscards');
  md.replaceChildren();
  if(mySeat) mySeat.discards.forEach((d, i)=>{
    const discardTarget = myTurn && picked && picked.src === 'hand';
    const f = fan(d, '', pickedIs('discard', i) ? 'picked' : '');
    f.classList.toggle('target', !!discardTarget);
    peekable(f, me.id, i);
    f.onclick = (e)=>{
      if(picked && picked.src === 'hand') return discardTo(i);
      if(d.length) pick('discard', i, d[d.length-1]);
      e.stopPropagation();
    };
    const col = el('div', 'discard-col');
    col.appendChild(f);
    if(d.length > 1){
      const all = el('button', 'see-all', 'See all ' + d.length);
      all.onclick = (e)=>{ e.stopPropagation(); togglePeek(me.id, i, f); };
      col.appendChild(all);
    }
    md.appendChild(col);
  });
  const hand = $('hand');
  hand.replaceChildren();
  (v.hand || []).forEach((c, i)=>{
    const card = cardEl(c, pickedIs('hand', i) ? 'picked' : '');
    card.onclick = ()=> pick('hand', i, c);
    hand.appendChild(card);
  });

  $('btnPass').classList.toggle('hidden', !(myTurn && v.hand && !v.hand.length));
  $('hint').textContent = !mySeat ? "You'll be dealt in next round."
    : !myTurn ? ''
    : picked ? (picked.src === 'hand' ? 'Tap a pile in the middle to play it, or one of your discard piles to end your turn.' : 'Tap a pile in the middle to play it.')
    : 'Tap a card to pick it up. End your turn by discarding a card from your hand.';

  if(v.phase === 'play') refreshPeek(); else closePeek();

  // The end of a round.
  const over = v.phase === 'over';
  $('overlay').classList.toggle('hidden', !over);
  if(over){
    const w = v.seats.find(s=>s.uid===v.winner) || v.present.find(p=>p.id===v.winner);
    $('overTitle').textContent = v.winner === me.id ? 'You win!' : w ? w.name + ' wins' : 'Round over';
    $('overSub').textContent = v.log;
    $('btnAgain').classList.toggle('hidden', !isHost);
    $('overStatus').textContent = isHost ? '' : 'Waiting for the host…';
  }
}

// ================================================================
// EVERYONE — looking through a discard pile
// Hover a pile (on a computer) or tap it (someone else's, or "See all" under
// yours) and every card in it is laid out, bottom to top.
// ================================================================
let peekAt = null;      // {uid, i, anchor} the pile being looked through
let peekTimer = 0;
const canHover = window.matchMedia('(hover: hover)').matches;

function peekable(f, uid, i){
  f.dataset.peek = uid + ':' + i;
  if(!canHover) return;
  f.addEventListener('mouseenter', ()=>{
    clearTimeout(peekTimer);
    peekTimer = setTimeout(()=> openPeek(uid, i, f), 250);
  });
  f.addEventListener('mouseleave', ()=>{
    clearTimeout(peekTimer);
    peekTimer = setTimeout(closePeek, 120);
  });
}

function togglePeek(uid, i, anchor){
  if(peekAt && peekAt.uid === uid && peekAt.i === i) closePeek();
  else openPeek(uid, i, anchor);
}

function openPeek(uid, i, anchor){
  const seat = view && view.seats.find(s=>s.uid===uid);
  const cards = seat && seat.discards[i];
  if(!cards || cards.length < 2) return closePeek();
  peekAt = {uid, i, anchor};
  const box = $('peek');
  box.replaceChildren();
  box.appendChild(el('div', 'peek-title', (uid === me.id ? 'Your' : seat.name + "'s") + ' discard pile ' + (i + 1) + ' · ' + cards.length + ' cards'));
  const row = el('div', 'peek-row');
  cards.forEach((c, k)=>{
    const cell = el('div', 'peek-cell');
    cell.appendChild(cardEl(c, k === cards.length - 1 ? 'peek-top' : ''));
    cell.appendChild(el('div', 'pile-label', k === cards.length - 1 ? 'top' : k === 0 ? 'bottom' : ''));
    row.appendChild(cell);
  });
  box.appendChild(row);
  box.classList.remove('hidden');
  // Next to the pile: above it if there's room, otherwise below, and always on screen.
  const r = anchor.getBoundingClientRect(), b = box.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - b.width - 8, r.left + r.width/2 - b.width/2));
  let top = r.top - b.height - 8;
  if(top < 8) top = Math.min(window.innerHeight - b.height - 8, r.bottom + 8);
  box.style.left = left + 'px';
  box.style.top = Math.max(8, top) + 'px';
}

function closePeek(){
  peekAt = null;
  $('peek').classList.add('hidden');
}

/** The table was drawn again: keep the pile open, with its cards as they are now. */
function refreshPeek(){
  if(!peekAt) return;
  const anchor = document.querySelector('[data-peek="' + peekAt.uid + ':' + peekAt.i + '"]');
  if(anchor) openPeek(peekAt.uid, peekAt.i, anchor);
  else closePeek();
}

/** On a phone there's no room at the sides, so everyone sits across the top. */
function narrowTable(){ return window.innerWidth < 760; }

/**
 * Cards are as big as the window allows. Height is handled in the CSS; this caps them by width,
 * counting how many card widths a row of the table needs: another player's box is about 3.4 card
 * widths, and your own area and the center piles about 6.2.
 */
function fitCards(sideBoxes, topBoxes){
  const units = narrowTable() ? 7.5 : sideBoxes * 3.4 + Math.max(6.2, topBoxes * 3.5);
  const cap = (window.innerWidth - 40 - (sideBoxes + Math.max(1, topBoxes)) * 20) / units;
  document.documentElement.style.setProperty('--wcap', Math.max(30, cap).toFixed(1) + 'px');
}

/** How many of the other players sit on your left, across from you, and on your right. */
function seatsAround(n){
  if(narrowTable() || n <= 1) return [0, n, 0];
  if(n === 2) return [1, 0, 1];
  if(n <= 4) return [1, n - 2, 1];
  return [2, n - 4, 2];
}

/** A discard pile, fanned so every card in it shows; only the top one can be played. */
function fan(cards, size, topCls){
  const f = el('div', 'fan' + (size ? ' ' + size : ''));
  if(!cards.length){ f.appendChild(el('div', 'card empty' + (size ? ' ' + size : ''))); return f; }
  const shown = cards.slice(-8);
  shown.forEach((c, i)=> f.appendChild(cardEl(c, (size||'') + (i === shown.length-1 && topCls ? ' ' + topCls : ''))));
  return f;
}

// ================================================================
// EVERYONE — moves
// ================================================================
function pickedIs(src, i){ return !!picked && picked.src === src && picked.i === i; }

function pickedStillThere(){
  if(!picked || !view) return false;
  const s = view.seats.find(x=>x.uid===me.id);
  if(!s || view.turn !== me.id) return false;
  if(picked.src === 'hand') return view.hand && view.hand[picked.i] === picked.c;
  if(picked.src === 'stock') return s.top === picked.c;
  const d = s.discards[picked.i];
  return !!d && d[d.length-1] === picked.c;
}

function pick(src, i, c){
  if(!view || view.phase !== 'play' || view.turn !== me.id) return;
  picked = pickedIs(src, i) ? null : {src, i, c};
  renderTable();
}

function send(a){
  picked = null;
  if(isHost) act(me.id, a);
  else { toPeiskos({kind:'send', to:hostUid, data:a}); renderTable(); }
}

function playTo(pile){
  if(!picked || view.turn !== me.id) return;
  const b = view.builds[pile];
  if(!(picked.c === WILD || picked.c === b.n + 1)){
    showToast(b.n ? 'That pile needs a ' + (b.n + 1) : 'That pile needs a 1');
    return;
  }
  send({type:'play', src:picked.src, i:picked.i, c:picked.c, pile});
}

function discardTo(pile){
  if(!picked || picked.src !== 'hand' || view.turn !== me.id) return;
  send({type:'discard', i:picked.i, c:picked.c, pile});
}

// ================================================================
// Buttons
// ================================================================
function leaveGame(){ toPeiskos({kind:'leave'}); }
$('btnLeaveLobby').onclick = leaveGame;
$('btnLeaveOver').onclick = leaveGame;
$('btnQuit').onclick = leaveGame;
$('btnPass').onclick = ()=> send({type:'pass'});
$('btnStart').onclick = ()=>{
  if(!isHost || phase !== 'lobby' || present.length < 2) return;
  deal();
  publish();
};
$('btnAgain').onclick = ()=>{
  if(!isHost) return;
  phase = 'lobby';
  G = null;
  publish();
};
$('stockSelect').onchange = ()=>{
  if(!isHost) return;
  stockSetting = $('stockSelect').value;
  publish();
};
// The seats move between the sides and the top as the window changes size.
let resizeTimer = 0;
window.addEventListener('resize', ()=>{
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(()=>{ if(view && view.phase !== 'lobby') renderTable(); }, 120);
});
// Tapping the table (not a card) puts the card back down.
$('table').addEventListener('click', (e)=>{
  if(peekAt && !e.target.closest('.fan, .see-all, #peek')) closePeek();
  if(picked && !e.target.closest('.card, .fan')){ picked = null; renderTable(); }
});

// ================================================================
// PEISKOS
// ================================================================
window.addEventListener('message', e=>{
  if(e.source !== window.parent) return;
  const m = e.data;
  if(!m || typeof m !== 'object') return;
  if(m.kind === 'init'){
    me = {id:m.me.id, name:shortName(m.me.name)};
    hostUid = m.hostId;
    isHost = me.id === hostUid;
    $('btnQuit').title = isHost ? 'End the game for everyone' : 'Leave this game';
    if(isHost) syncPlayers(m.players || []);
    else { showScreen('lobbyScreen'); $('lobbyStatus').textContent = 'Joining…'; toPeiskos({kind:'send', to:hostUid, data:{type:'hello'}}); }
  } else if(m.kind === 'players'){
    if(isHost && me) syncPlayers(m.players || []);
  } else if(m.kind === 'msg'){
    if(!me || !m.data || typeof m.data !== 'object') return;
    if(isHost){
      if(m.data.type === 'hello') toPeiskos({kind:'send', to:m.from, data:viewFor(m.from)});
      else act(m.from, m.data);
    } else if(m.from === hostUid && m.data.type === 'view'){
      show(m.data);
    }
  }
});
toPeiskos({kind:'ready'});

})();
