// Same Page, Odd One Out and Fireside Trivia, played by real browsers at the same fire.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, closeBrowser, fireWith, joinGame, leaveGame, noErrors, sees, startGame, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });

const panel = (seat) => seat.game().locator('#panel');
const scores = async (seat) => Object.fromEntries((await seat.game().locator('.scores li').allTextContents()).map((li) => {
  const m = /^(?:\S+ )?(.+?)(\d+)$/u.exec(li.trim());
  return [m[1].replace(/^(🥇|🥈|🥉|\d+\.) /u, ''), Number(m[2])];
}));

test('Same Page: answers stay secret until the reveal, matching ones score, and the clock moves it on', async (t) => {
  const { seats } = await fireWith(t, server.base, ['Maya', 'Theo', 'Ines']);
  const [maya, theo, ines] = seats;
  const answer = async (seat, text) => {
    await seat.game().locator('#answer').fill(text);
    await seat.game().locator('#answer').press('Enter');
  };

  // The lobby: one player can't start.
  await startGame(maya, 'samepage');
  await sees(panel(maya), 'Same Page needs 2 players');
  assert.equal(await maya.game().getByRole('button', { name: 'Start' }).isDisabled(), true);
  await joinGame(theo);
  await joinGame(ines);
  await sees(maya.game().locator('.players'), /Maya.*Theo.*Ines/);
  await sees(panel(theo), 'Waiting for Maya to start.');
  assert.equal(await theo.game().getByRole('button', { name: 'Start' }).count(), 0, 'only the host can start');
  await maya.game().locator('#optCount').selectOption('5');
  await maya.game().getByRole('button', { name: 'Start' }).click();

  // Prompt 1: everyone has the same prompt.
  const ask = await sees(maya.game().locator('#ask'), /\S/);
  for (const s of [theo, ines]) await sees(s.game().locator('#ask'), ask);
  await sees(panel(ines), 'Prompt 1 of 5');

  // An empty answer isn't sent.
  await answer(theo, '   ');
  await sees(theo.game().locator('#toast'), 'Type an answer.');

  // Theo is halfway through typing when Maya's answer comes in: his text stays, and he can't see hers.
  await theo.game().locator('#answer').fill('panc');
  await answer(maya, 'The Pancakes');
  await sees(panel(maya), 'Your answer The Pancakes');
  await sees(panel(theo), '1 of 3 have answered');
  assert.equal(await theo.game().locator('#answer').inputValue(), 'panc');
  assert.doesNotMatch(await panel(theo).innerText(), /Pancakes/);
  assert.doesNotMatch(await panel(ines).innerText(), /Pancakes/);

  // "The Pancakes" and "pancake" are the same answer; "Waffles" is on its own.
  await answer(theo, 'pancake');
  await answer(ines, 'Waffles');
  await sees(theo.game().locator('.page.shared'), /The Pancakes \+1 each Maya, You/);
  await sees(panel(theo), '1 friend wrote the same as you. +1');
  await sees(ines.game().locator('.page.mine'), /Waffles no match You/);
  await sees(panel(ines), 'Nobody else wrote that.');
  for (const s of seats) assert.deepEqual(await scores(s), { Maya: 1, Theo: 1, Ines: 0 });

  // The reveal lasts ten seconds on the host's clock.
  await maya.wait(10.5);
  await sees(panel(theo), 'Prompt 2 of 5');

  // Prompt 2: only Maya answers, and time runs out for the others.
  await answer(maya, 'Alone');
  await sees(panel(maya), '1 of 3 have answered');
  await maya.wait(30.5);
  await sees(panel(theo), "You didn't answer in time.");
  await sees(panel(maya), 'No answer from Theo, Ines.');
  await sees(panel(maya), 'Nobody else wrote that.');
  assert.deepEqual(await scores(ines), { Maya: 1, Theo: 1, Ines: 0 });
  await maya.wait(10.5);

  // Prompt 3: Ines leaves while the others have answered, so the round doesn't wait for her.
  await sees(panel(ines), 'Prompt 3 of 5');
  await answer(maya, 'Tea');
  await answer(theo, 'tea');
  await sees(panel(theo), '2 of 3 have answered');
  await leaveGame(ines);
  await sees(theo.game().locator('.page.shared'), /Tea \+1 each Maya, You/);
  assert.deepEqual(await scores(theo), { Maya: 2, Theo: 2 }, "someone who left isn't listed");
  await maya.wait(10.5);

  // Prompt 4: Ines comes back mid-prompt and is dealt straight in.
  await sees(panel(theo), 'Prompt 4 of 5');
  await joinGame(ines);
  await sees(panel(ines), 'Prompt 4 of 5');
  await sees(panel(maya), '0 of 3 have answered');
  for (const s of seats) await answer(s, 'Same thing');
  await sees(ines.game().locator('.page.shared'), /Same thing \+2 each Maya, Theo, You/);
  assert.deepEqual(await scores(maya), { Maya: 4, Theo: 4, Ines: 2 });
  await maya.wait(10.5);

  // Prompt 5, then the final scores, and the host takes everyone back to the lobby.
  await sees(panel(theo), 'Prompt 5 of 5');
  await maya.wait(30.5);
  await sees(panel(theo), 'Nobody answered.');
  await maya.wait(10.5);
  for (const s of seats) await sees(panel(s), 'Final scores');
  await sees(panel(theo), 'Maya can start another game.');
  assert.deepEqual(await scores(theo), { Maya: 4, Theo: 4, Ines: 2 });
  await maya.game().getByRole('button', { name: 'Back to the lobby' }).click();
  for (const s of seats) await sees(panel(s), 'A prompt comes up and everyone answers in secret');
  noErrors(seats);
});

test('Odd One Out: one different word, clues in turn, the vote, the getaway guess, and a round with no odd one out', async (t) => {
  const { seats } = await fireWith(t, server.base, ['Maya', 'Theo', 'Ines', 'Noor']);
  const [maya, theo, ines, noor] = seats;
  const word = (seat) => seat.game().locator('.slip strong').innerText();
  const giveClue = async (seat, text) => {
    await seat.game().locator('#clue').fill(text);
    await seat.game().locator('#clue').press('Enter');
  };
  /** Who's in the round, in clue order, with the word each was dealt; `odd` is the one with the other word. */
  const dealt = async (playing) => {
    const order = (await maya.game().locator('.seat .who').allTextContents()).map((n) => n.replace(' (you)', ''));
    const round = [];
    for (const name of order) {
      const seat = playing.find((s) => s.name === name);
      round.push({ seat, word: await word(seat) });
    }
    const count = (w) => round.filter((r) => r.word === w).length;
    const odd = round.find((r) => count(r.word) === 1);
    return { round, odd: odd.seat, oddWord: odd.word, mainWord: round.find((r) => r.seat !== odd.seat).word, others: round.filter((r) => r.seat !== odd.seat).map((r) => r.seat) };
  };
  const vote = (from, to) => from.game().locator('button.seat', { hasText: to.name }).click();

  // Two can't start; three can.
  await startGame(maya, 'oddoneout');
  await joinGame(theo);
  await sees(panel(theo), 'Odd One Out needs 3 players');
  assert.equal(await maya.game().getByRole('button', { name: 'Start' }).isDisabled(), true);
  await joinGame(ines);
  await sees(panel(theo), 'Waiting for Maya to start.');
  await maya.game().locator('#optRounds').selectOption('3');
  await maya.game().locator('#optClues').selectOption('1');
  await maya.game().getByRole('button', { name: 'Start' }).click();

  // ---- Round 1: everyone votes for the odd one out, who is caught.
  await sees(panel(ines), 'Round 1 of 3');
  let d = await dealt([maya, theo, ines]);
  assert.equal(d.others.length, 2, 'two share a word and one has another');
  assert.notEqual(d.oddWord, d.mainWord);
  // Nobody is told which they are.
  for (const s of [maya, theo, ines]) assert.equal(await s.game().locator('.slip small').innerText(), 'Your word');

  // Noor sits down mid-round and watches it.
  await joinGame(noor);
  await sees(panel(noor), "You're watching this round.");
  assert.equal(await noor.game().locator('.slip').count(), 0, 'no word for someone watching');

  // Only whoever's turn it is can give a clue, and it has to be one word that isn't their own.
  const [first, second, third] = d.round;
  await sees(second.seat.game().locator('.note'), `${first.seat.name} is giving a clue.`);
  assert.equal(await second.seat.game().locator('#clue').count(), 0);
  await giveClue(first.seat, 'two words');
  await sees(first.seat.game().locator('#toast'), 'One word only.');
  await giveClue(first.seat, first.word.replace(/\s+/g, '').toUpperCase());
  await sees(first.seat.game().locator('#toast'), "Your clue can't be the word itself.");
  await giveClue(first.seat, 'alpha');
  await sees(third.seat.game().locator('.seat', { hasText: first.seat.name }), 'alpha');
  await giveClue(second.seat, 'bravo');
  await giveClue(third.seat, 'charlie');

  // The vote: you can't vote for yourself, and a vote can't be changed.
  await sees(panel(maya), "Whose clues don't fit your word?");
  assert.equal(await maya.game().locator('button.seat').count(), 2);
  assert.equal(await noor.game().locator('button.seat').count(), 0, "someone watching doesn't vote");
  const [a, b] = d.others;
  await vote(a, d.odd);
  await sees(a.game().locator('.note'), `You voted for ${d.odd.name}. 1 of 3 have voted.`);
  assert.equal(await a.game().locator('button.seat:not([disabled])').count(), 0);
  await vote(b, d.odd);
  await vote(d.odd, a);
  await sees(panel(a), `${d.odd.name} was the odd one out, and got caught.`);
  await sees(panel(d.odd), 'You were the odd one out, and got caught.');
  await sees(a.game().locator('.slip.pair'), new RegExp(`Everyone else had ${d.mainWord}.*${d.odd.name} had ${d.oddWord}`, 's'));
  await sees(a.game().locator('.gain'), '+2');
  let want = { [a.name]: 2, [b.name]: 2, [d.odd.name]: 0, Noor: 0 };
  for (const s of seats) assert.deepEqual(await scores(s), want);

  // ---- Round 2 (four playing now): the first clue runs out of time, the vote misses, and the odd one out guesses the word.
  await maya.wait(10.5);
  await sees(panel(noor), 'Round 2 of 3');
  d = await dealt(seats);
  assert.equal(d.others.length, 3);
  await sees(d.round[0].seat.game().locator('.note'), 'Your turn.');
  await maya.wait(30.5);
  await sees(d.round[1].seat.game().locator('.seat', { hasText: d.round[0].seat.name }), 'no clue');
  for (const r of d.round.slice(1)) await giveClue(r.seat, `clue${r.seat.name}`);
  await sees(panel(maya), "Whose clues don't fit your word?");
  // Everyone piles on one of the others.
  const [scapegoat, friend] = d.others;
  for (const s of seats) await vote(s, s === scapegoat ? friend : scapegoat);
  await sees(panel(scapegoat), `${d.odd.name} was the odd one out and got away with it. They get one guess at your word.`);
  await sees(panel(d.odd), "Guess everyone else's word for 2 more points.");
  assert.equal(await scapegoat.game().locator('#guess').count(), 0, 'only the odd one out guesses');
  await d.odd.game().locator('#guess').fill(` ${d.mainWord.toUpperCase()}! `);
  await d.odd.game().locator('#guess').press('Enter');
  await sees(panel(friend), new RegExp(`${d.odd.name} was the odd one out, and got away with it\\. Their guess, ".*", was right\\.`));
  await sees(d.odd.game().locator('.gain'), '+5');
  want[d.odd.name] += 5;
  for (const s of seats) assert.deepEqual(await scores(s), want);

  // ---- Round 3: the odd one out leaves, so nobody scores, and the game ends after it.
  await maya.wait(10.5);
  await sees(panel(noor), 'Round 3 of 3');
  d = await dealt(seats);
  if (d.odd === maya) {
    // The host leaving would end the game for everyone, which is another test: let the clock run this round out instead.
    for (let i = 0; i < 4; i++) { await maya.wait(30.5); }
    await sees(panel(maya), "Whose clues don't fit your word?");
    await maya.wait(60.5);
    await sees(panel(theo), 'Maya was the odd one out and got away with it.');
    await maya.wait(25.5);
    await sees(panel(theo), 'No guess at the word.');
    want.Maya += 3;
  } else {
    await leaveGame(d.odd);
    await sees(panel(maya), 'The odd one out left, so nobody scores this round.');
    delete want[d.odd.name];
  }
  assert.deepEqual(await scores(maya), want);
  await maya.wait(10.5);
  await sees(panel(maya), 'Final scores');
  assert.deepEqual(await scores(maya), want);
  noErrors(seats);
});

test('Odd One Out: a round needs three, so the game goes back to the lobby when too many leave', async (t) => {
  const { seats } = await fireWith(t, server.base, ['Maya', 'Theo', 'Ines']);
  const [maya, theo, ines] = seats;
  await startGame(maya, 'oddoneout');
  await joinGame(theo);
  await joinGame(ines);
  await sees(panel(theo), 'Waiting for Maya to start.');
  await maya.game().getByRole('button', { name: 'Start' }).click();
  await sees(panel(theo), 'Round 1 of 5');
  // Whoever leaves, the round ends early or carries on with two; the next one can't start.
  await leaveGame(ines);
  await sees(maya.game().locator('.seats, .slip.pair'), /\S/);
  for (let i = 0; i < 12 && !(await maya.game().getByRole('button', { name: 'Start' }).count()); i++) await maya.wait(61);
  await sees(panel(maya), 'Odd One Out needs 3 players. Waiting for more to join.');
  await sees(panel(theo), 'Odd One Out needs 3 players. Waiting for more to join.');
  noErrors(seats);
});

test("Fireside Trivia: a hearth's own questions, faster right answers score more, and slow ones score nothing", async (t) => {
  const { hearth, seats } = await fireWith(t, server.base, ['Maya', 'Theo']);
  const [maya, theo] = seats;
  const own = [
    { question: 'Who burnt the pancakes at the cabin?', answer: 'Theo', wrong: ['Maya', 'Ines'] },
    { question: 'What is the cabin called?', answer: 'Peiskos', wrong: ['Burrow'] },
  ];
  for (const body of own) await call(server.base, `/api/servers/${hearth.id}/trivia`, { body, token: maya.token });

  /** What a right answer given straight away scored: 50, up to 50 more for speed, and 20 for a medium question. */
  const quick = async (seat) => {
    const gain = Number((await sees(seat.game().locator('#gain'), /^\+\d+$/)).slice(1));
    assert.ok(gain >= 110 && gain <= 120, `nearly all the speed points: got ${gain}`);
    return gain;
  };

  await startGame(maya, 'trivia');
  await joinGame(theo);
  await sees(panel(theo), 'Waiting for Maya to start.');

  // Anyone playing can add a question, from inside the game.
  await theo.game().getByRole('button', { name: 'Our questions' }).click();
  await sees(theo.game().locator('.own'), 'Who burnt the pancakes at the cabin? (Theo)');
  await theo.game().getByLabel('Question').fill('How many beds are in the loft?');
  await theo.game().getByLabel('Right answer').fill('Four');
  await theo.game().getByLabel('Wrong answer', { exact: true }).fill('Two');
  await theo.game().getByRole('button', { name: 'Add question' }).click();
  await sees(theo.game().locator('.own'), 'How many beds are in the loft? (Four)');
  own.push({ question: 'How many beds are in the loft?', answer: 'Four', wrong: ['Two'] });
  // Theo can take out his own, not Maya's.
  assert.equal(await theo.game().locator('.own li', { hasText: 'Remove' }).count(), 1);

  // The host's list of categories picks the new question up; a round of only the hearth's own.
  const ours = maya.game().locator('.cats label', { hasText: 'Our hearth' });
  await sees(ours.locator('.n'), '3');
  await ours.locator('input').check();
  await maya.game().locator('#optCount').selectOption('5');
  await maya.game().getByRole('button', { name: 'Start' }).click();

  // A round starting brings Theo back from the questions page.
  await sees(panel(theo), 'Question 1 of 3');
  const want = { Maya: 0, Theo: 0 };
  for (let n = 1; n <= 3; n++) {
    await sees(panel(theo), `Question ${n} of 3`);
    const asked = await maya.game().locator('#question').innerText();
    const q = own.find((o) => o.question === asked);
    assert.ok(q, `"${asked}" is one of the hearth's own`);
    assert.equal(await theo.game().locator('#question').innerText(), asked);
    assert.equal(await maya.game().locator('.answer').count(), q.wrong.length + 1);
    const pick = (seat, text) => seat.game().locator('.answer', { hasText: new RegExp(`^${text}$`) }).click();
    if (n === 1) {
      // Maya is right at once; Theo is wrong. Nobody sees the answer before both are in.
      await pick(maya, q.answer);
      await sees(maya.game().locator('#gain'), '1 of 2 answered');
      assert.equal(await maya.game().locator('.answer.right').count(), 0);
      assert.equal(await maya.game().locator('.answer:not([disabled])').count(), 0, 'one answer each');
      await pick(theo, q.wrong[0]);
      want.Maya += await quick(maya);
      await sees(theo.game().locator('#gain'), 'Not this time');
      await sees(theo.game().locator('.answer.right'), new RegExp(`${q.answer}.*Maya`));
      await sees(theo.game().locator('.answer.wrong'), new RegExp(`${q.wrong[0]}.*Theo`));
    } else if (n === 2) {
      // Ten seconds in, a right answer is worth less; Maya never answers.
      await maya.wait(10);
      await pick(theo, q.answer);
      await sees(theo.game().locator('#gain'), '1 of 2 answered');
      await maya.wait(5.5);
      const gain = Number((await sees(theo.game().locator('#gain'), /^\+\d+$/)).slice(1));
      assert.ok(gain >= 85 && gain <= 88, `a third of the speed points left: got ${gain}`);
      await sees(maya.game().locator('#gain'), 'Too slow');
      want.Theo += gain;
    } else {
      await pick(maya, q.answer);
      await pick(theo, q.answer);
      want.Maya += await quick(maya);
      want.Theo += await quick(theo);
    }
    assert.deepEqual(await scores(theo), want);
    await maya.wait(5.5);
  }
  for (const s of seats) await sees(panel(s), 'Final scores');
  assert.deepEqual(await scores(theo), want);
  noErrors(seats);
});
