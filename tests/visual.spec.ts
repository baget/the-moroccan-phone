import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

async function canvasIsLit(page: Page): Promise<{ ok: boolean; buckets: number }> {
  const png = PNG.sync.read(await page.locator('#game-canvas').screenshot());
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));
  for (let px = 0; px < png.width * png.height; px += stride) {
    const o = px * 4;
    buckets.add(`${png.data[o] >> 4},${png.data[o + 1] >> 4},${png.data[o + 2] >> 4}`);
  }
  return { ok: buckets.size > 20, buckets: buckets.size };
}

const diag = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!);

test('full round with real input, then retry', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const mobile = testInfo.project.name.includes('mobile');

  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  expect(await canvasIsLit(page)).toMatchObject({ ok: true });
  await testInfo.attach('title', { body: await page.screenshot(), contentType: 'image/png' });

  await page.locator('#play-button').click();
  await expect.poll(async () => (await diag(page)).state).toBe('aiming');

  for (let i = 0; i < 10; i += 1) {
    await expect.poll(async () => (await diag(page)).state, { timeout: 5000 }).toBe('aiming');
    const d = await diag(page);
    const { x, y } = d.noseScreen;
    if (mobile) {
      // Touch aim is lifted above the finger; tap below the nose to compensate.
      const liftPx = await page.evaluate(() => Math.min(110, window.innerHeight * 0.12));
      await page.touchscreen.tap(x, y + liftPx);
    } else {
      await page.mouse.move(x, y + 200);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 5 });
      await page.mouse.up();
    }
    await expect.poll(async () => (await diag(page)).phonesUsed).toBe(i + 1);
    if (i === 1) {
      await page.waitForTimeout(250);
      await testInfo.attach('hit', { body: await page.screenshot(), contentType: 'image/png' });
    }
  }
  await expect.poll(async () => (await diag(page)).state, { timeout: 5000 }).toBe('gameover');
  const end = await diag(page);
  console.log(`${testInfo.project.name}: score=${end.score} noseHits=${end.noseHits} injuries=${end.injuries}`);
  expect(end.noseHits).toBeGreaterThanOrEqual(3);
  await testInfo.attach('end', { body: await page.screenshot(), contentType: 'image/png' });

  await page.locator('#again-button').click();
  await expect.poll(async () => (await diag(page)).state).toBe('aiming');
  expect((await diag(page)).score).toBe(0);
  expect(errors.filter((e) => !e.includes('fonts.g'))).toEqual([]);
});
