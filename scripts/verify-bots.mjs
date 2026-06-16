/**
 * Verify the AI opponent character (bot) system:
 *  - opponent chip shows the default bot
 *  - gallery modal opens and lists characters
 *  - selecting a bot updates the chip / opponent row / ELO
 *  - the personality engine path still produces an AI move (MultiPV wiring intact)
 *  - opening identity: a bot signs its first White move
 * Run with: node scripts/verify-bots.mjs   (dev server must be on :5180)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = 'http://localhost:5180';

async function moveCount(page) {
  return page.$$eval('[data-ply]', els => els.length);
}
async function firstSan(page) {
  return page.$$eval('[data-ply]', els =>
    els.map(e => e.textContent.replace(/[♟♞♝♜♛♚]/g, '').trim()))
    .then(a => a[0] || '');
}
async function clickSquare(page, file, rank) {
  // not flipped (player = white): row 0 = rank 8 at top, col 0 = file a
  const col = 'abcdefgh'.indexOf(file);
  const row = 8 - rank;
  const box = await page.locator('.chess-board').boundingBox();
  const x = box.x + (col + 0.5) * box.width / 8;
  const y = box.y + (row + 0.5) * box.height / 8;
  await page.mouse.click(x, y);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  // Ignore external resource-load failures (e.g. the Lichess opening-book API returning 401/429
  // in a headless/rate-limited environment) — those are network, not regressions in our code.
  const isExternalResource = t => /Failed to load resource/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isExternalResource(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(3000); // let Stockfish worker init

  let ok = true;
  const check = (name, cond) => { ok = ok && cond; console.log(`[${name}] ${cond ? '✅' : '❌'}`); };

  // Default opponent chip (bruno = 곰돌 브루노 by default)
  const defaultChip = await page.getByRole('button', { name: /곰돌 브루노/ }).first().isVisible().catch(() => false);
  check('default opponent chip = 곰돌 브루노', defaultChip);

  // Open gallery
  await page.getByRole('button', { name: /곰돌 브루노/ }).first().click();
  await page.waitForTimeout(400);
  const galleryOpen = await page.getByText('상대를 선택하세요').isVisible().catch(() => false);
  check('gallery opens', galleryOpen);
  const hawkCard = await page.getByText('킹 사냥꾼').isVisible().catch(() => false);
  const shellyCard = await page.getByText('철벽 포지셔널').isVisible().catch(() => false);
  check('character cards rendered (호크 + 셸리)', hawkCard && shellyCard);

  // Select 매 호크 (aggressive, personalityActive) → closes + new game (player still white, AI black)
  await page.getByRole('button', { name: /매 호크/ }).first().click();
  await page.waitForTimeout(600);
  const chipHawk = await page.getByRole('button', { name: /매 호크.*ELO 1600/ }).first().isVisible().catch(() => false);
  check('chip updates to 매 호크 ELO 1600', chipHawk);

  // Personality engine path: player plays e2e4, AI (호크) must reply
  await clickSquare(page, 'e', 2);
  await page.waitForTimeout(150);
  await clickSquare(page, 'e', 4);
  await page.waitForTimeout(6000); // wait for AI reply (movetime + overhead)
  const cnt = await moveCount(page);
  check('AI personality move produced (>=2 plies)', cnt >= 2);

  // Opening identity: swap (AI = white) then pick 거북 셸리 (openings c2c4) → first move c4
  await page.getByRole('button', { name: /White|Black/ }).first().click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /매 호크|곰돌|상대/ }).first().click().catch(() => {});
  // open via the top-bar chip explicitly
  await page.waitForTimeout(200);
  const shellyBtn = page.getByRole('button', { name: /거북 셸리/ }).first();
  if (!(await shellyBtn.isVisible().catch(() => false))) {
    // gallery may not be open; open it via opponent row
    await page.getByTitle('상대 선택').first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: /거북 셸리/ }).first().click();
  await page.waitForTimeout(1500);
  const fm = await firstSan(page);
  check(`opening identity 셸리 → c4 (got "${fm}")`, fm === 'c4');

  check('no console/page errors', errors.length === 0);
  if (errors.length) console.log('  errors:', errors.slice(0, 5));

  console.log(`\n${ok ? '✅ ALL BOT CHECKS PASSED' : '❌ FAILURES DETECTED'}`);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
