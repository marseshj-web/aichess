/**
 * Quick mobile-layout verification.
 * Checks horizontal overflow + right-panel width at a phone viewport, takes screenshots.
 * Run with: node scripts/verify-mobile.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = 'http://localhost:5180';

async function checkAt(page, w, h, label) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const panel = document.querySelector('.right-panel');
    const board = document.querySelector('.chess-board');
    const topbar = document.querySelector('.top-bar');
    return {
      scrollW: doc.scrollWidth,
      clientW: doc.clientWidth,
      panelW: panel ? Math.round(panel.getBoundingClientRect().width) : null,
      boardW: board ? Math.round(board.getBoundingClientRect().width) : null,
      topbarH: topbar ? Math.round(topbar.getBoundingClientRect().height) : null,
    };
  });
  const overflow = m.scrollW - m.clientW;
  console.log(`\n[${label}] ${w}x${h}`);
  console.log(`  horizontal overflow: ${overflow}px ${overflow <= 1 ? '✅' : '❌ OVERFLOW'}`);
  console.log(`  right-panel width:   ${m.panelW}px (viewport ${m.clientW}) ${m.panelW && m.panelW <= m.clientW + 1 ? '✅' : '❌'}`);
  console.log(`  board width:         ${m.boardW}px`);
  console.log(`  top-bar height:      ${m.topbarH}px`);
  await page.screenshot({ path: `scripts/mobile-${w}.png`, fullPage: false });
  return overflow <= 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  let ok = true;
  ok = (await checkAt(page, 360, 740, 'small phone')) && ok;
  ok = (await checkAt(page, 390, 844, 'iphone-ish')) && ok;
  ok = (await checkAt(page, 768, 1024, 'tablet portrait')) && ok;
  ok = (await checkAt(page, 1280, 800, 'desktop')) && ok;

  console.log(`\n${ok ? '✅ ALL VIEWPORTS: no horizontal overflow' : '❌ overflow detected'}`);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
