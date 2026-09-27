import { chromium, devices } from '@playwright/test';
const [,, runId='pass-1'] = process.argv;
const browser = await chromium.launch({ channel: 'chromium' });
const out = `artifacts/captures/${runId}`;
import fs from 'node:fs'; fs.mkdirSync(out, { recursive: true });
for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 720 } }], ['mobile', devices['iPhone 13']]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => m.type()==='error' && errs.push(m.text()));
  await page.goto('http://127.0.0.1:5188');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-title.png` });
  for (const st of ['active-play', 'nosebleed', 'battered', 'game-over']) {
    await page.evaluate(async (s) => { const h = window.__THREE_GAME_TEST_HOOKS__; h.seed(7); h.setState(s); }, st);
    await page.waitForTimeout(st === 'battered' || st === 'nosebleed' ? 300 : 500);
    await page.screenshot({ path: `${out}/${name}-${st}.png` });
    const d = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
    console.log(name, st, JSON.stringify({ state: d.state, score: d.score, nose: d.noseHits, inj: d.injuries, lastZone: d.lastZone, calls: d.renderer.calls, tris: d.renderer.triangles }));
  }
  console.log(name, 'errors', errs);
  await ctx.close();
}
await browser.close();
