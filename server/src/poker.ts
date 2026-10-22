// Texas hold 'em: the cards, what a hand is worth, and one table's play from the blinds to the
// showdown. The casino (casino.ts) seats people and moves their chips; this file only runs the game.
import { randomInt } from 'node:crypto';

/** A card is its rank and suit, like "As" (ace of spades) or "Td" (ten of diamonds). */
export type Card = string;
const RANKS = '23456789TJQKA';
const SUITS = 'shdc';

/** Cards in a random order: `decks` full decks shuffled together. */
export function shuffledDeck(decks = 1): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) for (const r of RANKS) for (const s of SUITS) cards.push(r + s);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

const rankOf = (c: Card) => RANKS.indexOf(c[0]) + 2; // 2 to 14
const RANK_NAMES = ['', '', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const plural = (r: number) => (r === 6 ? 'Sixes' : RANK_NAMES[r] + 's');

/** Five cards' worth: a bigger score wins, and the name says what it is ("Two pair, Kings and Sevens"). */
function fiveCardHand(cards: Card[]): { score: number; name: string } {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const unique = [...new Set(ranks)];
  let straightHigh = 0;
  if (unique.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5) straightHigh = 5; // the wheel, A-2-3-4-5
  }
  // Ranks by how many there are of each, then how high: the order ties are broken in.
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const order = groups.map((g) => g[0]);
  const score = (category: number, kickers: number[]) => kickers.reduce((s, k) => s * 15 + k, category) * 15 ** (5 - kickers.length);
  if (straightHigh && flush)
    return { score: score(8, [straightHigh]), name: straightHigh === 14 ? 'Royal flush' : `Straight flush, ${RANK_NAMES[straightHigh]} high` };
  if (groups[0][1] === 4) return { score: score(7, order), name: `Four of a kind, ${plural(order[0])}` };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { score: score(6, order), name: `Full house, ${plural(order[0])} full of ${plural(order[1])}` };
  if (flush) return { score: score(5, ranks), name: `Flush, ${RANK_NAMES[ranks[0]]} high` };
  if (straightHigh) return { score: score(4, [straightHigh]), name: `Straight, ${RANK_NAMES[straightHigh]} high` };
  if (groups[0][1] === 3) return { score: score(3, order), name: `Three of a kind, ${plural(order[0])}` };
  if (groups[0][1] === 2 && groups[1][1] === 2) return { score: score(2, order), name: `Two pair, ${plural(order[0])} and ${plural(order[1])}` };
  if (groups[0][1] === 2) return { score: score(1, order), name: `Pair of ${plural(order[0])}` };
  return { score: score(0, ranks), name: `${RANK_NAMES[ranks[0]]} high` };
}

/** The best five of five to seven cards. */
export function bestHand(cards: Card[]): { score: number; name: string; cards: Card[] } {
  let best: { score: number; name: string; cards: Card[] } | null = null;
  const chosen: Card[] = [];
  const pick = (from: number) => {
    if (chosen.length === 5) {
      const h = fiveCardHand(chosen);
      if (!best || h.score > best.score) best = { ...h, cards: [...chosen] };
      return;
    }
    for (let i = from; i <= cards.length - (5 - chosen.length); i++) {
      chosen.push(cards[i]);
      pick(i + 1);
      chosen.pop();
    }
  };
  pick(0);
  return best!;
}

export const MAX_SEATS = 8;

type Seat = {
  userId: number;
  stack: number;
  cards: Card[];
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  bet: number; // put in on this street
  total: number; // put in this hand
  need: boolean; // still has to act before the street ends
  raiseSeen: number; // how many full raises there had been when they last acted this street (-1: not yet)
  sittingOut: boolean;
  leaving: boolean;
  shown: boolean;
  lastAction: string;
  won: number;
  handName: string;
};

type Hand = {
  deck: Card[];
  board: Card[];
  street: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  toAct: number; // seat index, or -1 between actions
  deadline: number;
  currentBet: number;
  minRaise: number;
  fullRaises: number;
  sb: number;
  bb: number;
  done: boolean;
  winners: number[]; // seat indexes, once it's over
};

export interface TableOptions {
  smallBlind: number;
  bigBlind: number;
  /** How long someone has to act, and how long when they're offline. */
  turnMs: number;
  awayTurnMs: number;
  /** The pause between hands, and between cards when everyone left is all in. */
  pauseMs: number;
  dealMs: number;
  isOnline: (userId: number) => boolean;
  /** Chips going back to someone's wallet when they get up. */
  cashOut: (userId: number, chips: number) => void;
  /** Stacks as they stand between hands (and before the blinds), to keep in case of a restart. */
  settled: (stacks: { userId: number; stack: number }[]) => void;
  changed: () => void;
  /** Tests stack the deck. */
  deck?: () => Card[];
}

export type Action = { action: 'fold' | 'check' | 'call' | 'raise' | 'allin'; to?: number };

export class PokerTable {
  seats: (Seat | null)[] = Array(MAX_SEATS).fill(null);
  button = -1;
  hand: Hand | null = null;
  log: string[] = [];
  handNo = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private opts: TableOptions;

  constructor(opts: TableOptions) {
    this.opts = opts;
  }

  seatOf(userId: number) {
    return this.seats.findIndex((s) => s?.userId === userId);
  }

  /** Sits someone down with chips from their wallet (taken by the caller). */
  sit(userId: number, seat: number, chips: number) {
    if (this.seatOf(userId) >= 0) throw new Error("You're already at this table");
    if (!(seat >= 0 && seat < MAX_SEATS) || this.seats[seat]) throw new Error('That seat is taken');
    this.seats[seat] = {
      userId, stack: chips, cards: [], inHand: false, folded: false, allIn: false, bet: 0, total: 0, need: false, raiseSeen: -1,
      sittingOut: false, leaving: false, shown: false, lastAction: '', won: 0, handName: '',
    };
    this.note(`@${userId} sat down`);
    this.settle();
    this.maybeStart();
    this.opts.changed();
  }

  /** More chips for someone's stack, between hands. */
  addChips(userId: number, chips: number) {
    const s = this.seats[this.seatOf(userId)];
    if (!s) throw new Error("You aren't at this table");
    if (s.inHand && this.hand && !this.hand.done) throw new Error('Wait for this hand to finish');
    s.stack += chips;
    this.settle();
    this.maybeStart();
    this.opts.changed();
  }

  /** Gets up: right away between hands, or folds and gets up when the hand is over. */
  stand(userId: number) {
    const i = this.seatOf(userId);
    const s = this.seats[i];
    if (!s) return;
    if (s.inHand && this.hand && !this.hand.done) {
      s.leaving = true;
      if (!s.folded) this.fold(i, 'Left');
      this.opts.changed();
      return;
    }
    this.seats[i] = null;
    this.opts.cashOut(userId, s.stack);
    this.note(`@${userId} got up`);
    this.settle();
    this.opts.changed();
  }

  /** Sits out the next hands, or comes back in. */
  setSittingOut(userId: number, out: boolean) {
    const s = this.seats[this.seatOf(userId)];
    if (!s) throw new Error("You aren't at this table");
    s.sittingOut = out;
    if (!out) this.maybeStart();
    this.opts.changed();
  }

  /** Everyone gets their chips back as they were before this hand, and the table closes. */
  close() {
    this.clearTimer();
    for (const s of this.seats) if (s) this.opts.cashOut(s.userId, s.stack + (this.hand && !this.hand.done ? s.total : 0));
    this.seats = Array(MAX_SEATS).fill(null);
    this.hand = null;
  }

  get empty() {
    return this.seats.every((s) => !s);
  }

  private note(text: string) {
    this.log.push(text);
    if (this.log.length > 30) this.log.shift();
  }

  private settle() {
    this.opts.settled(this.seats.flatMap((s) => (s ? [{ userId: s.userId, stack: s.stack }] : [])));
  }

  /** Stops the clock (the server is shutting down). */
  stopTimers() {
    this.clearTimer();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private later(ms: number, fn: () => void) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
      this.opts.changed();
    }, ms);
    this.timer.unref?.();
  }

  private ready() {
    return this.seats.filter((s): s is Seat => !!s && s.stack > 0 && !s.sittingOut && !s.leaving);
  }

  /** A new hand starts a moment after there are two people ready to play. */
  private maybeStart() {
    if (this.timer || (this.hand && !this.hand.done)) return;
    if (this.ready().length < 2) return;
    this.later(this.hand ? this.opts.pauseMs : Math.min(this.opts.pauseMs, 1500), () => this.startHand());
  }

  private next(from: number, ok: (s: Seat) => boolean) {
    for (let k = 1; k <= MAX_SEATS; k++) {
      const i = (from + k) % MAX_SEATS;
      const s = this.seats[i];
      if (s && ok(s)) return i;
    }
    return -1;
  }

  private startHand() {
    // Whoever got up during the last hand leaves the table now.
    for (let i = 0; i < MAX_SEATS; i++) {
      const s = this.seats[i];
      if (s?.leaving) {
        this.seats[i] = null;
        this.opts.cashOut(s.userId, s.stack);
      }
    }
    for (const s of this.seats)
      if (s) Object.assign(s, { cards: [], inHand: false, folded: false, allIn: false, bet: 0, total: 0, need: false, raiseSeen: -1, shown: false, lastAction: '', won: 0, handName: '' });
    this.settle();
    const players = this.ready();
    if (players.length < 2) {
      this.hand = null;
      return;
    }
    for (const s of players) s.inHand = true;
    const live = (s: Seat) => s.inHand;
    this.button = this.next(this.button, live);
    const headsUp = players.length === 2;
    const sbSeat = headsUp ? this.button : this.next(this.button, live);
    const bbSeat = this.next(sbSeat, live);
    const deck = this.opts.deck?.() ?? shuffledDeck();
    this.hand = {
      deck, board: [], street: 'preflop', toAct: -1, deadline: 0, currentBet: 0, minRaise: this.opts.bigBlind, fullRaises: 0,
      sb: sbSeat, bb: bbSeat, done: false, winners: [],
    };
    this.handNo++;
    this.put(sbSeat, this.opts.smallBlind);
    this.put(bbSeat, this.opts.bigBlind);
    this.seats[sbSeat]!.lastAction = 'Small blind';
    this.seats[bbSeat]!.lastAction = 'Big blind';
    this.hand.currentBet = this.opts.bigBlind;
    // Two cards each, one at a time, starting left of the button.
    for (let round = 0; round < 2; round++)
      for (let k = 1; k <= MAX_SEATS; k++) {
        const i = (this.button + k) % MAX_SEATS;
        if (this.seats[i]?.inHand) this.seats[i]!.cards.push(deck.pop()!);
      }
    for (const s of players) s.need = !s.allIn;
    this.moveTo(this.next(bbSeat, (s) => s.inHand && !s.folded && !s.allIn));
  }

  /** Chips from a seat's stack into the pot (all of them, if that's all it has). */
  private put(i: number, amount: number) {
    const s = this.seats[i]!;
    const chips = Math.min(amount, s.stack);
    s.stack -= chips;
    s.bet += chips;
    s.total += chips;
    if (s.stack === 0) s.allIn = true;
  }

  private moveTo(i: number): void {
    const h = this.hand!;
    if (i < 0 || !this.seats[i]?.need) return this.afterAction();
    h.toAct = i;
    const s = this.seats[i]!;
    const wait = this.opts.isOnline(s.userId) && !s.sittingOut ? this.opts.turnMs : this.opts.awayTurnMs;
    h.deadline = Date.now() + wait;
    this.later(wait, () => this.timedOut(i));
  }

  private timedOut(i: number) {
    const h = this.hand;
    const s = this.seats[i];
    if (!h || h.done || h.toAct !== i || !s) return;
    // Out of time: check if that's free, otherwise fold, and sit out until they're back.
    s.sittingOut = true;
    if (s.bet === h.currentBet) this.apply(i, { action: 'check' });
    else this.fold(i, 'Fold');
  }

  /** What the seat whose turn it is may do. */
  options(i: number) {
    const h = this.hand;
    const s = this.seats[i];
    if (!h || h.done || h.toAct !== i || !s) return null;
    const toCall = Math.min(h.currentBet - s.bet, s.stack);
    const canRaise = s.stack > h.currentBet - s.bet && (s.raiseSeen < 0 || s.raiseSeen < h.fullRaises) && this.othersCanAct(i);
    const maxTo = s.bet + s.stack;
    return {
      toCall,
      canCheck: toCall === 0,
      canRaise,
      minRaiseTo: Math.min(maxTo, h.currentBet + h.minRaise),
      maxRaiseTo: maxTo,
    };
  }

  /** Someone besides this seat still has chips to bet with (no point raising into all-ins only). */
  private othersCanAct(i: number) {
    return this.seats.some((s, j) => j !== i && s?.inHand && !s.folded && !s.allIn);
  }

  /** A move by the person whose turn it is. */
  act(userId: number, move: Action) {
    const i = this.seatOf(userId);
    const h = this.hand;
    if (i < 0 || !h || h.done) throw new Error('No hand going');
    if (h.toAct !== i) throw new Error("It isn't your turn");
    this.seats[i]!.sittingOut = false;
    this.apply(i, move);
    this.opts.changed();
  }

  private apply(i: number, move: Action): void {
    const h = this.hand!;
    const s = this.seats[i]!;
    const o = this.options(i)!;
    if (move.action === 'fold') return this.fold(i, 'Fold');
    if (move.action === 'check') {
      if (!o.canCheck) throw new Error('You have to call or fold');
      s.lastAction = 'Check';
    } else if (move.action === 'call') {
      if (o.toCall === 0) s.lastAction = 'Check';
      else {
        this.put(i, o.toCall);
        s.lastAction = s.allIn ? 'All in' : `Call ${s.bet}`;
      }
    } else {
      // A raise to `to` chips on this street, or everything.
      const to = move.action === 'allin' ? o.maxRaiseTo : Math.floor(Number(move.to));
      if (move.action === 'allin' && !o.canRaise) {
        // All in for no more than a call.
        this.put(i, o.toCall);
        s.lastAction = s.allIn ? 'All in' : o.toCall ? `Call ${s.bet}` : 'Check';
      } else {
        if (!o.canRaise) throw new Error("You can't raise now");
        if (!Number.isFinite(to) || to > o.maxRaiseTo) throw new Error("You don't have that many chips");
        if (to < o.minRaiseTo) throw new Error(`The smallest raise is to ${o.minRaiseTo}`);
        const raise = to - h.currentBet;
        const opening = h.currentBet === 0;
        this.put(i, to - s.bet);
        if (raise >= h.minRaise) {
          h.minRaise = raise;
          h.fullRaises++;
        }
        h.currentBet = Math.max(h.currentBet, s.bet);
        s.lastAction = s.allIn ? 'All in' : opening ? `Bet ${s.bet}` : `Raise to ${s.bet}`;
        // Everyone else still in has to answer it.
        for (const t of this.seats) if (t && t !== s && t.inHand && !t.folded && !t.allIn) t.need = true;
      }
    }
    s.need = false;
    s.raiseSeen = h.fullRaises;
    this.afterAction(i);
  }

  private fold(i: number, label: string): void {
    const s = this.seats[i]!;
    s.folded = true;
    s.need = false;
    s.lastAction = label;
    const h = this.hand!;
    if (h.toAct === i) this.afterAction(i);
    else if (this.seats.filter((t) => t?.inHand && !t.folded).length === 1) this.afterAction(h.toAct);
  }

  private afterAction(from = this.hand!.toAct): void {
    const h = this.hand!;
    this.clearTimer();
    h.toAct = -1;
    const live = this.seats.filter((s): s is Seat => !!s?.inHand && !s.folded);
    if (live.length === 1) return this.finish();
    const nextUp = this.next(from < 0 ? this.button : from, (s) => s.inHand && !s.folded && !s.allIn && s.need);
    if (nextUp >= 0) return this.moveTo(nextUp);
    this.endStreet();
  }

  private endStreet(): void {
    const h = this.hand!;
    for (const s of this.seats)
      if (s?.inHand) {
        s.bet = 0;
        s.raiseSeen = -1;
        s.need = !s.folded && !s.allIn;
        if (!s.folded && !s.allIn) s.lastAction = '';
      }
    h.currentBet = 0;
    h.minRaise = this.opts.bigBlind;
    h.fullRaises = 0;
    const canBet = this.seats.filter((s) => s?.inHand && !s.folded && !s.allIn).length;
    if (h.street === 'river') return this.finish();
    if (canBet < 2) {
      // Nobody left to bet against: the cards are turned over and the rest of the board comes out.
      for (const s of this.seats) if (s?.inHand && !s.folded) s.shown = true;
      for (const s of this.seats) if (s) s.need = false;
      this.dealStreet();
      this.later(this.opts.dealMs, () => this.endStreet());
      return;
    }
    this.dealStreet();
    this.moveTo(this.next(this.button, (s) => s.inHand && !s.folded && !s.allIn));
  }

  private dealStreet() {
    const h = this.hand!;
    h.deck.pop(); // burn
    if (h.street === 'preflop') {
      h.board.push(h.deck.pop()!, h.deck.pop()!, h.deck.pop()!);
      h.street = 'flop';
    } else if (h.street === 'flop') {
      h.board.push(h.deck.pop()!);
      h.street = 'turn';
    } else {
      h.board.push(h.deck.pop()!);
      h.street = 'river';
    }
  }

  /** The pot goes to whoever is left, or to the best hands, pot by pot when someone was all in for less. */
  private finish() {
    const h = this.hand!;
    this.clearTimer();
    h.toAct = -1;
    const seats = this.seats.map((s, i) => [s, i] as const).filter((x): x is readonly [Seat, number] => !!x[0]?.inHand);
    const live = seats.filter(([s]) => !s.folded);
    const name = (s: Seat) => `@${s.userId}`;
    if (live.length === 1) {
      const [s, i] = live[0];
      const pot = seats.reduce((n, [t]) => n + t.total, 0);
      s.stack += pot;
      s.won = pot;
      h.winners = [i];
      this.note(`${name(s)} won ${pot}`);
    } else {
      h.street = 'showdown';
      const scored = new Map<Seat, { score: number; name: string }>();
      for (const [s] of live) {
        const best = bestHand([...s.cards, ...h.board]);
        scored.set(s, best);
        s.handName = best.name;
        s.shown = true;
      }
      // Side pots: each level of chips put in is shared by those who put in at least that much.
      const levels = [...new Set(seats.map(([s]) => s.total).filter((t) => t > 0))].sort((a, b) => a - b);
      let prev = 0;
      let carry = 0;
      const winners = new Set<number>();
      for (const level of levels) {
        let amount = carry;
        for (const [s] of seats) amount += Math.max(0, Math.min(s.total, level) - prev);
        prev = level;
        const eligible = live.filter(([s]) => s.total >= level);
        if (!eligible.length) {
          carry = amount;
          continue;
        }
        carry = 0;
        const top = Math.max(...eligible.map(([s]) => scored.get(s)!.score));
        const best = eligible.filter(([s]) => scored.get(s)!.score === top);
        // Split evenly; odd chips go to the first winners left of the button.
        best.sort((a, b) => ((a[1] - this.button + MAX_SEATS - 1) % MAX_SEATS) - ((b[1] - this.button + MAX_SEATS - 1) % MAX_SEATS));
        const share = Math.floor(amount / best.length);
        let odd = amount - share * best.length;
        for (const [s, i] of best) {
          const chips = share + (odd-- > 0 ? 1 : 0);
          s.stack += chips;
          s.won += chips;
          winners.add(i);
        }
      }
      if (carry) {
        // Chips nobody still in could win (shouldn't happen): back to the best hand there is.
        const [s, i] = live.reduce((a, b) => (scored.get(b[0])!.score > scored.get(a[0])!.score ? b : a));
        s.stack += carry;
        s.won += carry;
        winners.add(i);
      }
      h.winners = [...winners];
      for (const i of h.winners) {
        const s = this.seats[i]!;
        this.note(`${name(s)} won ${s.won} with ${s.handName.replace(/^./, (c) => c.toLowerCase())}`);
      }
    }
    h.done = true;
    for (const s of this.seats) if (s) s.need = false;
    this.settle();
    // People who got up during the hand leave now; the next hand deals after a look at this one.
    this.later(this.opts.pauseMs, () => this.startHand());
  }

  /** The table as one person sees it: their own cards, and everyone else's only once they're shown. */
  view(userId: number) {
    const h = this.hand;
    const me = this.seatOf(userId);
    return {
      handNo: this.handNo,
      smallBlind: this.opts.smallBlind,
      bigBlind: this.opts.bigBlind,
      button: this.button,
      board: h?.board ?? [],
      street: h?.street ?? null,
      done: h?.done ?? true,
      pot: this.seats.reduce((n, s) => n + (s?.inHand ? s.total - s.bet : 0), 0),
      currentBet: h?.currentBet ?? 0,
      toAct: h && !h.done ? h.toAct : -1,
      deadline: h && !h.done && h.toAct >= 0 ? h.deadline : 0,
      winners: h?.done ? h.winners : [],
      seats: this.seats.map((s, i) =>
        s
          ? {
              userId: s.userId,
              stack: s.stack,
              bet: s.bet,
              inHand: s.inHand,
              folded: s.folded,
              allIn: s.allIn,
              sittingOut: s.sittingOut,
              leaving: s.leaving,
              lastAction: s.lastAction,
              won: s.won,
              handName: s.shown ? s.handName : '',
              online: this.opts.isOnline(s.userId),
              cards: s.inHand && (i === me || s.shown) ? s.cards : s.inHand && !s.folded ? ['??', '??'] : [],
            }
          : null,
      ),
      options: me >= 0 ? this.options(me) : null,
      log: this.log.slice(-8),
    };
  }
}
