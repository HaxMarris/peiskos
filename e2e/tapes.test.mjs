// Fire tapes: everyone at the fire is asked and it's taped once all say yes, with "Clip that" and
// the tapes list; a no stops it. There's no LiveKit here, so nobody's microphone is recorded: the
// server's tests send real audio.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, fireWith, noErrors, sees, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });
const shot = (seat, name) => process.env.E2E_SHOTS && seat.page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` });

test('a fire is taped once everyone says yes, its tapes are listed, and a no stops it', async (t) => {
  const { seats } = await fireWith(t, server.base, ['Maya', 'Theo'], { phone: ['Theo'] });
  const [maya, theo] = seats;

  // Maya asks; Theo is asked on his phone, and says yes.
  await maya.page.locator('#fire-tape').click();
  await sees(maya.page.locator('#modal-card h2'), 'Tape this fire');
  if (process.env.E2E_SHOTS) await maya.page.waitForTimeout(500);
  await shot(maya, 'tape-start');
  await maya.page.getByRole('button', { name: 'Ask everyone' }).click();
  await sees(theo.page.locator('#tape-panel'), /Maya wants to tape this fire/);
  await sees(maya.page.locator('#tape-panel'), /Asking everyone/);
  await shot(theo, 'asked-phone');
  await theo.page.getByRole('button', { name: 'Tape me' }).click();
  for (const s of seats) await sees(s.page.locator('#tape-panel'), /Taping/);
  await until(async () => (await maya.page.locator('.seat-rec').count()) === 2, 'both seats to be marked');
  assert.equal(await maya.page.locator('#tape-panel').getAttribute('data-phase'), 'taping');

  // Clip that: everyone sees who clipped it.
  await theo.page.getByRole('button', { name: 'Clip that' }).click();
  await sees(maya.page.locator('#fire-notes'), /Theo clipped that/);
  await sees(maya.page.locator('#tape-panel'), /1 clip/);
  await shot(maya, 'taping-desktop');
  await shot(theo, 'taping-phone');

  await maya.page.getByRole('button', { name: 'Stop' }).click();
  await sees(theo.page.locator('#fire-notes'), /Maya stopped the tape/);
  await until(() => theo.page.locator('#tape-panel').isHidden(), 'the panel to close');

  // The tapes list. No microphone was taped here, so once it's put together the tape is empty.
  await maya.page.locator('#fire-tape').click();
  await maya.page.getByRole('button', { name: 'Past tapes' }).click();
  await sees(maya.page.locator('#modal-card h2'), 'Tapes from Campfire');
  await sees(maya.page.locator('.tape-item').first(), /Maya, Theo|Theo, Maya/);
  await sees(maya.page.locator('.tape-item').first(), /Nothing was taped/, 30000);
  await shot(maya, 'tapes-list');
  await maya.page.keyboard.press('Escape');

  // Asked again, Theo says no: nothing is taped.
  await maya.page.locator('#fire-tape').click();
  await maya.page.getByRole('button', { name: 'Ask everyone' }).click();
  await theo.page.getByRole('button', { name: 'Not me' }).click();
  await sees(maya.page.locator('#fire-notes'), /Theo said no, so nothing is taped/);
  await until(() => maya.page.locator('#tape-panel').isHidden(), 'the panel to close');
  noErrors(seats);
});
