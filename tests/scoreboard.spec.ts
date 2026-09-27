import { expect, test, type Page } from '@playwright/test';

const diag = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!);

async function playRoundAtNose(page: Page): Promise<number> {
  for (let i = 0; i < 10; i += 1) {
    await expect.poll(async () => (await diag(page)).state, { timeout: 5000 }).toBe('aiming');
    const { x, y } = (await diag(page)).noseScreen;
    await page.evaluate(([px, py]) => window.__THREE_GAME_TEST_HOOKS__!.throwAtScreen(px, py), [x, y]);
    await expect.poll(async () => (await diag(page)).phonesUsed).toBe(i + 1);
  }
  await expect.poll(async () => (await diag(page)).state, { timeout: 5000 }).toBe('gameover');
  return (await diag(page)).score;
}

test('local top-10 scoreboard saves, renames and survives reload', async ({ page }) => {
  // Seed a table with one low score so the new round lands above it.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem(
      'moroccan-phone-scores',
      JSON.stringify([{ id: 'old', name: 'Grandpa', score: 5, noseHits: 0, bestCombo: 0, date: 1 }]),
    );
  });
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);

  // Title screen lists the saved score.
  await expect(page.locator('#title-scores')).toBeVisible();
  await expect(page.locator('#title-scores-list li')).toHaveCount(1);
  await expect(page.locator('#title-scores-list li').first()).toContainText('Grandpa');

  await page.locator('#play-button').click();
  const score = await playRoundAtNose(page);
  expect(score).toBeGreaterThan(5);

  // End screen: new row is first and highlighted, name box is shown.
  const rows = page.locator('#end-scores-list li');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveClass(/current/);
  await expect(rows.first().locator('.score-points')).toHaveText(String(score));
  await expect(page.locator('#name-entry')).toBeVisible();
  await expect(page.locator('#name-input')).toHaveValue('Player');

  // Typing a name updates the row live; Space/Enter must not restart the round.
  await page.locator('#name-input').fill('');
  await page.locator('#name-input').pressSequentially('Oren W');
  await page.locator('#name-input').press('Enter');
  expect((await diag(page)).state).toBe('gameover');
  await expect(rows.first().locator('.score-name')).toHaveText('Oren W');

  // Reload: table and name persist, sorted high to low.
  await page.reload();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  const titleRows = page.locator('#title-scores-list li');
  await expect(titleRows).toHaveCount(2);
  await expect(titleRows.nth(0).locator('.score-name')).toHaveText('Oren W');
  await expect(titleRows.nth(1).locator('.score-name')).toHaveText('Grandpa');
  await expect(page.locator('#best-title')).toHaveText(String(score));

  // A score that does not qualify (0) is not added and hides the name box.
  await page.locator('#play-button').click();
  for (let i = 0; i < 10; i += 1) {
    await expect.poll(async () => (await diag(page)).state, { timeout: 5000 }).toBe('aiming');
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.throwAtScreen(5, 5));
    await expect.poll(async () => (await diag(page)).phonesUsed).toBe(i + 1);
  }
  await expect.poll(async () => (await diag(page)).state, { timeout: 5000 }).toBe('gameover');
  expect((await diag(page)).score).toBe(0);
  await expect(page.locator('#name-entry')).toBeHidden();
  await expect(rows).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem('moroccan-phone-name'))).toBe('Oren W');
});
