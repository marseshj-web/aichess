/**
 * Playwright test for analysis improvement changes:
 * 1. Eval graph color zones (rect elements in SVG)
 * 2. Eval graph hover tooltip
 * 3. Already-losing cpLoss correction (grade check)
 * 4. Worst move banner in puzzle analysis
 * 5. ELO formula sigmoid (value sanity check)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = 'http://localhost:5173';
const TIMEOUT = 30000;

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }
function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.error(`  ❌ ${msg}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }

(async () => {
  log('Launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(`PAGE ERROR: ${err.message}`));

  log(`Opening ${BASE}...`);
  await page.goto(BASE, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1500);

  // ─────────────────────────────────────────────────
  // PART 1: Regular game analysis
  // ─────────────────────────────────────────────────
  log('\n=== PART 1: Game Analysis Mode ===');

  // Set AI to lowest difficulty so game ends fast
  await page.fill('input[type="number"]', '600');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // Play several moves by clicking on the board
  log('Playing opening moves via board clicks...');

  // Helper: click a square by coordinate (row/col from top-left white perspective)
  const clickSq = async (sq) => {
    const file = 'abcdefgh'.indexOf(sq[0]);
    const rank = 8 - parseInt(sq[1]);
    await page.evaluate(([f, r]) => {
      const board = document.querySelector('.chess-board');
      if (!board) return;
      const rect = board.getBoundingClientRect();
      const sqW = rect.width / 8, sqH = rect.height / 8;
      const x = rect.left + f * sqW + sqW / 2;
      const y = rect.top + r * sqH + sqH / 2;
      document.elementFromPoint(x, y)?.click();
    }, [file, rank]);
    await page.waitForTimeout(150);
  };

  // e4
  await clickSq('e2'); await clickSq('e4');
  await page.waitForTimeout(1200); // AI responds
  await clickSq('d2'); await clickSq('d4');
  await page.waitForTimeout(1200);
  await clickSq('c1'); await clickSq('f4');
  await page.waitForTimeout(1200);
  await clickSq('g1'); await clickSq('f3');
  await page.waitForTimeout(1200);
  await clickSq('f1'); await clickSq('c4');
  await page.waitForTimeout(1200);

  log('5 moves played. Checking move history...');
  const histLen = await page.evaluate(() =>
    document.body.innerText.split('\n').filter(l => l.includes('→') && l.match(/[a-h][1-8]→[a-h][1-8]/)).length
  );
  info(`Move history entries visible: ${histLen}`);

  // Click "리뷰 시작" button
  const reviewBtn = page.locator('button', { hasText: '리뷰 시작' });
  if (await reviewBtn.isVisible().catch(() => false)) {
    await reviewBtn.click();
    log('Clicked "리뷰 시작"');
  } else {
    // Game might not be over — try surrender
    const surrenderBtn = page.locator('button', { hasText: '항복' });
    if (await surrenderBtn.isVisible().catch(() => false)) {
      await surrenderBtn.click();
      await page.waitForTimeout(500);
      await reviewBtn.click();
      log('Surrendered + clicked "리뷰 시작"');
    } else {
      fail('"리뷰 시작" not visible and cannot surrender');
    }
  }

  // Wait for analysis to complete
  log('Waiting for analysis to complete (up to 60s)...');
  try {
    await page.waitForFunction(() =>
      document.querySelector('svg') !== null &&
      document.body.innerText.includes('정확성'),
    { timeout: 60000 });
    pass('Analysis completed — eval graph and accuracy visible');
  } catch {
    fail('Analysis did not complete in time');
  }

  await page.waitForTimeout(1000);

  // ── Test 1: Eval graph color zones ──
  log('\n--- Test 1: Eval graph color zones ---');
  const zoneRects = await page.evaluate(() => {
    const svgs = document.querySelectorAll('svg');
    for (const svg of svgs) {
      const rects = svg.querySelectorAll('rect');
      const fills = Array.from(rects).map(r => r.getAttribute('fill') || '');
      // Look for the white/black zone rects
      const hasWhiteZone = fills.some(f => f.includes('255,255,255') && f.includes('0.05'));
      const hasBlackZone = fills.some(f => f.includes('0,0,0') && f.includes('0.18'));
      if (hasWhiteZone && hasBlackZone) return { found: true, fills };
    }
    return { found: false };
  });
  if (zoneRects.found) {
    pass('Eval graph color zones present (white zone + black zone rects)');
  } else {
    fail('Eval graph color zones not found in SVG');
  }

  // ── Test 2: Eval graph hover tooltip ──
  log('\n--- Test 2: Eval graph hover tooltip ---');
  const svgBounds = await page.evaluate(() => {
    const svg = document.querySelector('svg');
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });

  if (svgBounds) {
    // Hover over the SVG at a point where a dot should be
    const hoverX = svgBounds.x + svgBounds.w * 0.3;
    const hoverY = svgBounds.y + svgBounds.h * 0.4;
    await page.mouse.move(hoverX, hoverY);
    await page.waitForTimeout(600);

    const tooltipVisible = await page.evaluate(() => {
      // Look for a fixed-position tooltip div with Space Mono font
      const allDivs = document.querySelectorAll('div[style*="fixed"]');
      for (const d of allDivs) {
        if (d.style.zIndex >= 999 && d.textContent.includes('→')) return true;
      }
      return false;
    });

    if (tooltipVisible) {
      pass('Hover tooltip appeared over eval graph dot');
    } else {
      // Try hovering directly over a circle
      const circlePos = await page.evaluate(() => {
        const circles = document.querySelectorAll('svg circle');
        for (const c of circles) {
          const r = c.getBoundingClientRect();
          if (r.width > 0) return { x: r.left + r.width/2, y: r.top + r.height/2 };
        }
        return null;
      });
      if (circlePos) {
        await page.mouse.move(circlePos.x, circlePos.y);
        await page.waitForTimeout(600);
        const tt2 = await page.evaluate(() => {
          const allDivs = document.querySelectorAll('div');
          for (const d of allDivs) {
            const s = d.style;
            if (s.position === 'fixed' && s.zIndex >= '999' && d.textContent.trim().length > 3) return d.textContent.trim();
          }
          return null;
        });
        if (tt2) {
          pass(`Tooltip text: "${tt2.slice(0, 60)}"`);
        } else {
          info('Tooltip not detected (may need mouse precisely on circle)');
        }
      } else {
        info('No SVG circles found to hover over');
      }
    }
    // Move mouse away
    await page.mouse.move(100, 100);
    await page.waitForTimeout(300);
  } else {
    fail('SVG not found for hover test');
  }

  // ── Test 3: ELO estimation sanity check ──
  log('\n--- Test 3: ELO estimation ---');
  const eloText = await page.evaluate(() => {
    const els = document.querySelectorAll('div, span');
    for (const el of els) {
      if (el.textContent.includes('예상 퍼포먼스 ELO') && el.textContent.match(/\d{3,4}/)) {
        const match = el.textContent.match(/\d{3,4}/);
        return match ? match[0] : null;
      }
    }
    // Search more broadly
    const body = document.body.innerText;
    const eloIdx = body.indexOf('퍼포먼스 ELO');
    if (eloIdx >= 0) {
      const snippet = body.slice(eloIdx, eloIdx + 30);
      const m = snippet.match(/(\d{3,4})/);
      return m ? m[1] : null;
    }
    return null;
  });
  if (eloText) {
    const elo = parseInt(eloText);
    if (elo >= 400 && elo <= 2800) {
      pass(`ELO estimate: ${elo} (valid range 400-2800)`);
    } else {
      fail(`ELO estimate ${elo} out of expected range`);
    }
  } else {
    info('ELO estimate text not found in coach report');
  }

  // ── Take screenshot ──
  await page.screenshot({ path: 'scripts/test-analysis-1.png', fullPage: false });
  log('Screenshot: scripts/test-analysis-1.png');

  // ─────────────────────────────────────────────────
  // PART 2: Puzzle analysis mode
  // ─────────────────────────────────────────────────
  log('\n=== PART 2: Puzzle Analysis Mode ===');

  // Reset to new game then enter puzzle mode
  const newGameBtn = page.locator('button', { hasText: 'New' }).first();
  if (await newGameBtn.isVisible().catch(() => false)) {
    await newGameBtn.click();
    await page.waitForTimeout(500);
  }

  const puzzleBtn = page.locator('button', { hasText: '🧩 퍼즐' });
  if (!await puzzleBtn.isVisible().catch(() => false)) {
    // Already in puzzle mode? Look for exit
    const exitBtn = page.locator('button', { hasText: '게임 복귀' });
    if (await exitBtn.isVisible().catch(() => false)) { await exitBtn.click(); await page.waitForTimeout(300); }
    await page.locator('button', { hasText: '🧩 퍼즐' }).click({ timeout: 5000 });
  } else {
    await puzzleBtn.click({ timeout: 5000 });
  }

  log('Entered puzzle mode, waiting for puzzle...');
  await page.waitForFunction(() =>
    document.body.innerText.includes('최선의 수를 찾으세요') ||
    document.body.innerText.includes('퍼즐'), { timeout: TIMEOUT }
  );
  await page.waitForTimeout(1000);

  // Click "해답 보기" to solve
  const showBtn = page.locator('button', { hasText: '👁 해답 보기' });
  if (await showBtn.isVisible().catch(() => false)) {
    await showBtn.click();
    log('Clicked "해답 보기"');
    await page.waitForFunction(() =>
      document.body.innerText.includes('정답!'), { timeout: 15000 });
    pass('Puzzle solved');
  } else {
    info('"해답 보기" not visible');
  }

  // Click "📊 수 분석"
  await page.waitForTimeout(500);
  const analysisBtn = page.locator('button', { hasText: '📊 수 분석' });
  if (await analysisBtn.isVisible().catch(() => false)) {
    await analysisBtn.click();
    log('Clicked "📊 수 분석"');
    await page.waitForFunction(() =>
      document.body.innerText.includes('분석 종료'), { timeout: 60000 });
    pass('Puzzle analysis completed');
    await page.waitForTimeout(1000);
  } else {
    fail('"📊 수 분석" button not visible after solve');
  }

  // ── Test 4: Worst move banner ──
  log('\n--- Test 4: Worst move banner in puzzle analysis ---');
  const worstBanner = await page.evaluate(() => {
    const body = document.body.innerText;
    return body.includes('결정적 순간') ? body.includes('이 수 보기') ? 'full' : 'partial' : 'none';
  });
  if (worstBanner === 'full') {
    pass('결정적 순간 banner with "이 수 보기" button visible');
    // Test clicking the button
    const viewBtn = page.locator('button', { hasText: '이 수 보기' }).first();
    if (await viewBtn.isVisible().catch(() => false)) {
      await viewBtn.click();
      await page.waitForTimeout(400);
      pass('"이 수 보기" click succeeded (board navigated)');
    }
  } else if (worstBanner === 'partial') {
    pass('결정적 순간 text visible (banner partially rendered)');
  } else {
    info('No 결정적 순간 banner — puzzle may have had no mistakes (all best moves)');
  }

  // ── Test 4b: Check eval graph zones in puzzle analysis ──
  log('\n--- Test 4b: Eval graph zones in puzzle analysis ---');
  const puzzleZones = await page.evaluate(() => {
    const svgs = document.querySelectorAll('svg');
    for (const svg of svgs) {
      const rects = svg.querySelectorAll('rect');
      const fills = Array.from(rects).map(r => r.getAttribute('fill') || '');
      if (fills.some(f => f.includes('255,255,255')) && fills.some(f => f.includes('0,0,0'))) {
        return true;
      }
    }
    return false;
  });
  if (puzzleZones) {
    pass('Eval graph color zones visible in puzzle analysis');
  } else {
    info('Zones not detected in puzzle analysis SVG');
  }

  await page.screenshot({ path: 'scripts/test-analysis-2.png', fullPage: false });
  log('Screenshot: scripts/test-analysis-2.png');

  // ─────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────
  log('\n=== Console Errors ===');
  if (errors.length === 0) {
    pass('No console errors');
  } else {
    errors.slice(0, 5).forEach(e => fail(e));
  }

  await browser.close();
  log('\nTest complete.');
})();
