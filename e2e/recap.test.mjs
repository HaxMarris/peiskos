// The year at the fire: one friend shows the hearth's year at the fire, the other is offered to
// watch, and their card follows along until it's stopped.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, closeBrowser, fireWith, noErrors, sees, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });

test('a recap shown at the fire moves for everyone watching', async (t) => {
  const { hearth, seats } = await fireWith(t, server.base, ['Maya', 'Theo']);
  const [maya, theo] = seats;
  const room = (await call(server.base, '/api/servers', { token: maya.token })).find((s) => s.id === hearth.id).channels.find((c) => c.kind === 'text').id;
  const hi = await call(server.base, `/api/channels/${room}/messages`, { body: { content: 'pizza at the fire tonight?' }, token: maya.token });
  await call(server.base, `/api/messages/${hi.id}/reactions`, { body: { emoji: '🍕' }, token: theo.token });

  // Maya starts it from the fire's decorations.
  await maya.page.locator('#fire-decor').click();
  await maya.page.locator('#decor-recap').click();
  await sees(maya.page.locator('#recap-card'), String(new Date().getMonth() === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear()));
  await sees(maya.page.locator('#recap-together-note'), 'Everyone at Campfire sees this');

  // Theo is offered it, and opens it on the same card.
  await sees(theo.toast(), 'Maya is showing');
  await theo.toast().locator('button', { hasText: 'Watch' }).click();
  await until(() => theo.page.evaluate(() => document.querySelector('#recap-card')?.dataset.card === 'open'), 'Theo on the first card');

  // Maya turns two cards; Theo's turns with hers.
  await maya.page.locator('[data-recap="next"]').click();
  await maya.page.locator('[data-recap="next"]').click();
  const mayas = await maya.page.evaluate(() => document.querySelector('#recap-card').dataset.card);
  assert.notEqual(mayas, 'open');
  await until(() => theo.page.evaluate((c) => document.querySelector('#recap-card').dataset.card === c, mayas), `Theo on ${mayas}`);
  await sees(theo.page.locator('#recap-card'), /Where the talking happened|Favourite reactions|Most reactions on one message/);

  // Theo can move it too.
  await theo.page.keyboard.press('ArrowRight');
  const theos = await theo.page.evaluate(() => document.querySelector('#recap-card').dataset.card);
  await until(() => maya.page.evaluate((c) => document.querySelector('#recap-card').dataset.card === c, theos), `Maya on ${theos}`);

  // Stopping it leaves Theo reading on his own.
  await maya.page.locator('#recap-share').click();
  await sees(theo.page.locator('#recap-share'), 'Show at the fire');
  await sees(theo.page.locator('#recap-together-note'), /^$/);
  await theo.page.locator('#recap-close').click();
  assert.equal(await theo.page.locator('#recap').count(), 0);
  noErrors(seats);
});
