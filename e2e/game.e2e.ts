import { type Browser, expect, type Page, test } from '@playwright/test';
import { initialState } from '../src/engine/rules';

const sq = (r: number, c: number) => `.cell[data-sq="${r * 6 + c}"]`;

/** A page with the help screen already seen, optionally starting from a saved local game. */
async function open(browser: Browser, savedGame?: unknown) {
  const context = await browser.newContext();
  await context.addInitScript((game) => {
    localStorage.setItem('dropship-chess:seen-help', '1');
    if (game) localStorage.setItem('dropship-chess:game:v1', JSON.stringify([game]));
  }, savedGame ?? null);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  return { page, errors };
}

/** Plays any legal move for whoever is to move on this page. */
async function anyMove(page: Page) {
  const moved = await page.evaluate(() => {
    for (const cell of document.querySelectorAll<HTMLButtonElement>('.cell')) {
      cell.click();
      const target = document.querySelector<HTMLButtonElement>('.cell.target, .cell.capture');
      if (target) {
        target.click();
        return true;
      }
    }
    return false;
  });
  expect(moved).toBe(true);
}

const status = (page: Page) => page.locator('.status');

test('local play: move, capture, drop', async ({ browser }) => {
  // Fixed start: R N Q K B R behind pawns.
  const { page, errors } = await open(browser, initialState());
  await page.tap(sq(4, 3));
  await page.tap(sq(3, 3)); // d2-d3
  await expect(status(page)).toHaveText('Black to move');
  await page.tap(sq(1, 2));
  await page.tap(sq(2, 2)); // c5-c4
  await page.tap(sq(3, 3));
  await page.tap(sq(2, 2)); // d3xc4
  await expect(page.locator('.hand-w .slot[data-kind="P"]')).toBeEnabled();
  await page.tap(sq(1, 0));
  await page.tap(sq(2, 0)); // a5-a4
  await page.tap('.hand-w .slot[data-kind="P"]');
  await page.tap(sq(3, 4)); // drop a pawn on e3
  await expect(page.locator(sq(3, 4))).toHaveAttribute('aria-label', /white pawn/);
  expect(errors).toEqual([]);
});

test('local play: no repeating an earlier position', async ({ browser }) => {
  const { page } = await open(browser, initialState());
  for (const [from, to] of [[[5, 1], [3, 2]], [[0, 1], [2, 2]], [[3, 2], [5, 1]]] as const) {
    await page.tap(sq(...from));
    await page.tap(sq(...to));
  }
  // Black's knight could go back to b6, but that would recreate the start.
  await page.tap(sq(2, 2));
  await expect(page.locator(`${sq(0, 1)}.target`)).toHaveCount(0);
  await expect(page.locator('.cell.target, .cell.capture').first()).toBeVisible();
});

test('vs computer: it replies to a move', async ({ browser }) => {
  const { page, errors } = await open(browser);
  await page.getByRole('button', { name: 'New' }).click();
  await page.locator('dialog[open] button[value=ai]').click();
  await expect(status(page)).toHaveText('Your move'); // the computer opens if it's White
  await anyMove(page);
  await expect(status(page)).toHaveText('Your move');
  expect(errors).toEqual([]);
});

test('online: invite, play, resign, rematch with colours swapped', async ({ browser }) => {
  const alice = await open(browser);
  await alice.page.getByRole('button', { name: 'New' }).click();
  await alice.page.locator('dialog[open] button[value=online]').click();
  await expect(status(alice.page)).toHaveText(/Waiting for your opponent/);

  const bob = await open(browser);
  await bob.page.goto(alice.page.url());
  await expect(status(alice.page)).toHaveText(/^Your move · first move within/);
  await expect(bob.page.locator('.board')).toHaveClass(/flipped/);

  await anyMove(alice.page);
  await expect(status(bob.page)).toHaveText(/^Your move/);
  await anyMove(bob.page);
  await expect(status(alice.page)).toHaveText('Your move');

  bob.page.once('dialog', (d) => d.accept());
  await bob.page.getByRole('button', { name: 'Resign' }).click();
  await expect(status(alice.page)).toHaveText(/You win by resignation/);
  await expect(status(bob.page)).toHaveText(/You lose by resignation/);

  await alice.page.getByRole('button', { name: 'Rematch' }).click();
  await expect(bob.page.getByRole('button', { name: 'Accept rematch' })).toBeVisible();
  await bob.page.getByRole('button', { name: 'Accept rematch' }).click();
  // Colours swap: Bob is now White and moves first; Alice's board is flipped.
  await expect(status(bob.page)).toHaveText(/^Your move · first move within/);
  await expect(alice.page.locator('.board')).toHaveClass(/flipped/);
  expect([...alice.errors, ...bob.errors]).toEqual([]);
});
