/**
 * Verify SAN move-list generation + PGN import (UCI path) + keyboard nav.
 * Imports known games via the UCI importer and reads back the rendered SAN.
 * Run with: node scripts/verify-san.mjs   (dev server must be on :5180)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = 'http://localhost:5180';

const games = [
  {
    name: 'Scholar mate (capture + #)',
    uci: 'e2e4 e7e5 f1c4 f8c5 d1h5 g8f6 h5f7',
    expect: ['e4', 'e5', 'Bc4', 'Bc5', 'Qh5', 'Nf6', 'Qxf7#'],
  },
  {
    name: 'Kingside castling (O-O)',
    uci: 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 e1g1',
    expect: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'],
  },
  {
    name: 'Knight disambiguation (Nfd4)',
    uci: 'e2e3 a7a6 g1f3 a6a5 b1c3 a5a4 c3e2 h7h6 f3d4',
    expect: ['e3', 'a6', 'Nf3', 'a5', 'Nc3', 'a4', 'Ne2', 'h6', 'Nfd4'],
  },
  {
    name: 'SAN import with move numbers',
    uci: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6',
    expect: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6'],
  },
];

let pendingPrompt = null;

async function readSans(page) {
  return page.$$eval('[data-ply]', els =>
    els.map(e => e.textContent.replace(/[♟♞♝♜♛♚]/g, '').trim()));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', async d => {
    if (d.type() === 'prompt') await d.accept(pendingPrompt || '');
    else await d.accept();
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  let allOk = true;

  for (const g of games) {
    // New Game to clear any prior state
    await page.getByRole('button', { name: /New/ }).first().click().catch(() => {});
    await page.waitForTimeout(300);

    pendingPrompt = g.uci;
    await page.getByText('📥 불러오기').first().click();
    await page.waitForTimeout(800); // moves apply ~20ms each

    const got = await readSans(page);
    const ok = JSON.stringify(got) === JSON.stringify(g.expect);
    allOk = allOk && ok;
    console.log(`\n[${g.name}] ${ok ? '✅' : '❌'}`);
    console.log(`  expected: ${g.expect.join(' ')}`);
    console.log(`  got:      ${got.join(' ')}`);
  }

  // Keyboard navigation: ArrowLeft should enter REVIEW (viewIdx != null)
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  const reviewVisible = await page.getByText('REVIEW', { exact: true }).isVisible().catch(() => false);
  console.log(`\n[Keyboard ◀ enters review] ${reviewVisible ? '✅' : '❌'}`);
  allOk = allOk && reviewVisible;

  // ArrowRight back to live should eventually clear REVIEW
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const reviewGone = !(await page.getByText('REVIEW', { exact: true }).isVisible().catch(() => false));
  console.log(`[Keyboard ▶ returns to live]  ${reviewGone ? '✅' : '❌'}`);
  allOk = allOk && reviewGone;

  console.log(`\n${allOk ? '✅ ALL SAN/NAV CHECKS PASSED' : '❌ FAILURES DETECTED'}`);
  await browser.close();
  process.exit(allOk ? 0 : 1);
})();
