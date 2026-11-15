// The heart of Peiskos, end to end: talking in a room, direct messages, and sitting at the fire
// (plus Fireside Angler opening, since the server and the game share its fish data).
// Two friends, each in a window of their own, and the server between them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, closeBrowser, closeWhenDone, makeHearth, noErrors, openApp, sees, sitDown, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });

/** Opens the hearth's room called `name` the way a person would: the hearth, then the room in the list. */
async function openRoom(seat, hearthId, name) {
  await seat.page.evaluate((id) => selectServer(id), hearthId);
  await seat.page.locator('#channel-list li', { hasText: name }).first().click();
  await seat.page.waitForFunction((n) => roomById(state.channelId)?.c.name === n, name);
}
const composer = (seat) => seat.page.locator('#composer-input');
const line = (seat, text) => seat.page.locator('#messages .line', { hasText: text });
/** Who a message shows as from: the name over its group. */
const author = (seat, text) => seat.page.locator('#messages .group', { has: seat.page.locator('.line', { hasText: text }) }).locator('.author').first();
async function say(seat, text) {
  await composer(seat).fill(text);
  await composer(seat).press('Enter');
}

test('a room: messages arrive live, and replies, edits, reactions and deleting reach the others', async (t) => {
  const hearth = await makeHearth(server.base, ['Maya', 'Theo']);
  const seats = [];
  closeWhenDone(t, seats);
  const [maya, theo] = [await openApp(server.base, hearth.people[0]), await openApp(server.base, hearth.people[1])];
  seats.push(maya, theo);
  await openRoom(maya, hearth.id, 'general');
  await openRoom(theo, hearth.id, 'general');

  await say(maya, 'Anyone up for a game tonight?');
  await sees(author(theo, 'Anyone up for a game tonight?'), 'Maya');

  // Theo replies to it; the reply shows what it answers.
  await line(theo, 'Anyone up for a game tonight?').hover();
  await line(theo, 'Anyone up for a game tonight?').getByTitle('Reply').click();
  await say(theo, 'Count me in');
  const reply = line(maya, 'Count me in');
  await sees(reply, 'Anyone up for a game tonight?');

  // Maya fixes her message with the up arrow, as in most chat apps.
  await composer(maya).press('ArrowUp');
  const edit = maya.page.locator('#messages textarea.edit');
  await edit.fill('Anyone up for a game at 8?');
  await edit.press('Enter');
  await sees(line(theo, 'Anyone up for a game at 8?'), '(edited)');

  // A reaction from Theo reaches Maya.
  const msgs = await call(server.base, `/api/channels/${await theo.page.evaluate(() => state.channelId)}/messages`, { token: theo.token });
  const first = msgs.find((m) => m.content === 'Anyone up for a game at 8?');
  await call(server.base, `/api/messages/${first.id}/reactions`, { body: { emoji: '🔥' }, token: theo.token });
  // Its button says who reacted, and how many.
  await sees(line(maya, 'Anyone up for a game at 8?').locator('.reaction[title="Theo"] .r-count'), '1');

  // Theo deletes his reply; after the few seconds he has to undo it, it's gone for Maya too.
  await line(theo, 'Count me in').hover();
  await line(theo, 'Count me in').getByTitle('More').click();
  await theo.page.locator('#pop-menu [role="menuitem"]', { hasText: /^Delete$/ }).click();
  await until(async () => (await line(maya, 'Count me in').count()) === 0, 'the reply to go', 15000);
  noErrors(seats);
});

test('a direct message: it opens from the hearth, and the other person gets it live', async (t) => {
  const hearth = await makeHearth(server.base, ['Ines', 'Omar']);
  const seats = [];
  closeWhenDone(t, seats);
  const [ines, omar] = [await openApp(server.base, hearth.people[0]), await openApp(server.base, hearth.people[1])];
  seats.push(ines, omar);

  await ines.page.evaluate((id) => openDm(id), omar.id);
  await ines.page.waitForFunction(() => isDm(state.servers.get(state.serverId)));
  await say(ines, 'Are you coming on Saturday?');
  await sees(author(ines, 'Are you coming on Saturday?'), 'Ines');

  // Omar hasn't opened it, but the conversation is there for him with the message in it.
  await until(() => omar.page.evaluate(() => state.dmOrder.length === 1), 'the conversation to reach Omar');
  await omar.page.evaluate(() => selectServer(state.dmOrder[0]));
  await sees(author(omar, 'Are you coming on Saturday?'), 'Ines');
  await say(omar, 'Yes!');
  await sees(author(ines, 'Yes!'), 'Omar');
  noErrors(seats);
});

test('the fire: sitting down, seeing who else is there, muting, and getting up', async (t) => {
  const hearth = await makeHearth(server.base, ['Lena', 'Sam']);
  const seats = [];
  closeWhenDone(t, seats);
  const [lena, sam] = [await openApp(server.base, hearth.people[0]), await openApp(server.base, hearth.people[1])];
  seats.push(lena, sam);
  await openRoom(lena, hearth.id, 'general');
  await openRoom(sam, hearth.id, 'general');

  // Lena sits down at the fire from the room list; Sam, still in general, sees her there.
  await lena.page.locator('#fire-main .fire-card .room-name').click();
  await lena.page.waitForFunction((id) => state.voice?.channelId === id && state.voice.connected, hearth.fireId);
  await sees(lena.page.locator('#voice-bar'), 'Voice connected');
  await sees(sam.page.locator('#fire-main .fire-card'), 'Lena');

  // Sam joins her: each sees the other's seat.
  await sam.page.locator('#fire-main .fire-card .room-name').click();
  await sam.page.waitForFunction((id) => state.voice?.channelId === id && state.voice.connected, hearth.fireId);
  await sees(sam.page.locator('.seat .seat-name'), 'Lena');
  await sees(lena.page.locator('.seat .seat-name'), 'Sam');

  // Lena mutes, and Sam sees it on her seat.
  await lena.page.locator('#voice-mute').click();
  await sees(sam.page.locator('.seat', { hasText: 'Lena' }).locator('.seat-status'), 'Muted');

  // Lena gets up: she's gone from Sam's fire.
  await lena.page.locator('#voice-leave').click();
  await lena.page.waitForFunction(() => !state.voice);
  await until(async () => (await sam.page.locator('.seat .seat-name', { hasText: 'Lena' }).count()) === 0, 'Lena to leave the fire');
  noErrors(seats);
});

test('Fireside Angler opens at the fire, with its waters and fish from fish-data.js', async (t) => {
  const hearth = await makeHearth(server.base, ['Ada']);
  const seats = [];
  closeWhenDone(t, seats);
  const ada = await sitDown(server.base, hearth, hearth.people[0]);
  seats.push(ada);
  await ada.page.evaluate(() => openFishing());
  const game = ada.page.frameLocator('#fishing-frame iframe');
  await sees(game.locator('body'), 'Millpond', 20000);
  noErrors(seats);
});
