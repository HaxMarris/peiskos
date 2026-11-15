// The tests skip time ahead on the host's window (seat.wait). Playwright 1.56's clock could undo a skip
// when its own once-every-100ms tick was halfway through running the page's timers, which made the
// timing tests fail now and then on a busy CI machine. This checks that a skip always sticks.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, launch } from './lib.mjs';

after(closeBrowser);

test('skipping time ahead always moves the clock forward by the whole skip', async () => {
  const ctx = await (await launch()).newContext();
  try {
    const page = await ctx.newPage();
    await page.clock.install();
    // Busy timers, like a game's host loop and countdown, so the clock's own tick is often mid-run.
    await page.setContent('<script>setInterval(() => { let x = 0; for (let i = 0; i < 2e5; i++) x += i; }, 16); setInterval(() => {}, 200);</script>');
    const short = [];
    for (let i = 0; i < 150; i++) {
      const before = await page.evaluate(() => Date.now());
      await page.clock.fastForward(10000);
      await new Promise((r) => setTimeout(r, Math.random() * 30));
      const moved = (await page.evaluate(() => Date.now())) - before;
      if (moved < 10000) short.push(moved);
    }
    assert.deepEqual(short, [], 'every 10 s skip moved the clock at least 10 s');
  } finally {
    await ctx.close();
  }
});
