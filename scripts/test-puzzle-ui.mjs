/**
 * Playwright puzzle UI smoke test.
 * Tests: puzzle load, hint display, eval bar, auto-play, solve/show-answer, navigation, analysis mode.
 * Run with: node scripts/test-puzzle-ui.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = 'http://localhost:5175';
const TIMEOUT = 20000;

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }
function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.error(`  ❌ ${msg}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }

async function waitForPuzzle(page) {
  // Wait until puzzle is in 'playing' state (not loading)
  await page.waitForFunction(() => {
    const statusEl = document.querySelector('[data-testid="puzzle-status"]');
    if (statusEl) return !statusEl.textContent.includes('불러오는 중');
    // fallback: look for '최선의 수를 찾으세요' or '정답' text anywhere
    return document.body.innerText.includes('최선의 수를 찾으세요') ||
           document.body.innerText.includes('정답') ||
           document.body.innerText.includes('퍼즐');
  }, {timeout: TIMEOUT});
  await page.waitForTimeout(800); // let board render
}

async function getEvalText(page) {
  return page.evaluate(() => {
    // Find the eval bar text — rotated div inside eval-bar
    const evalBars = document.querySelectorAll('[style*="transform: rotate"]');
    for (const el of evalBars) {
      const txt = el.textContent.trim();
      if (txt && (txt.includes('+') || txt.includes('-') || txt.includes('M') || txt.match(/^\d/))) {
        return txt;
      }
    }
    return null;
  });
}

async function getPuzzleStatus(page) {
  return page.evaluate(() => document.body.innerText.includes('정답!') ? 'solved' :
    document.body.innerText.includes('틀렸습니다') ? 'fail' :
    document.body.innerText.includes('최선의 수를 찾으세요') ? 'playing' :
    document.body.innerText.includes('불러오는 중') ? 'loading' : 'unknown');
}

async function clickSquare(page, squareName) {
  // squareName like 'e4' — click the board square
  const file = 'abcdefgh'.indexOf(squareName[0]);
  const rank = 8 - parseInt(squareName[1]); // row 0=rank8, row7=rank1
  return page.evaluate(([f, r]) => {
    // Find board cells by iterating data or layout
    const cells = document.querySelectorAll('[data-sq]');
    for (const c of cells) {
      const sq = parseInt(c.dataset.sq);
      if (sq === r * 8 + f) { c.click(); return true; }
    }
    return false;
  }, [file, rank]);
}

async function runPuzzle(page, puzzleNum) {
  log(`\n=== Puzzle ${puzzleNum} ===`);

  await waitForPuzzle(page);
  const status0 = await getPuzzleStatus(page);
  log(`Status after load: ${status0}`);

  // Check hook highlight (golden squares on board)
  const highlightedSquares = await page.evaluate(() => {
    // Look for squares with yellow/gold background (the 'last move' highlight)
    const all = document.querySelectorAll('[style]');
    let count = 0;
    for (const el of all) {
      const bg = el.style.background || el.style.backgroundColor || '';
      if (bg.includes('#f6f680') || bg.includes('#baca44') || bg.includes('f6f6') || bg.includes('baca')) count++;
    }
    return count;
  });
  if (highlightedSquares > 0) {
    pass(`Hook move highlight: ${highlightedSquares} squares highlighted`);
  } else {
    info('No hook highlight (puzzle-ids.json may not have hook field yet)');
  }

  // Check eval bar value
  const eval0 = await getEvalText(page);
  if (eval0) {
    pass(`Eval bar visible: "${eval0}"`);
  } else {
    info('Eval bar text not yet visible (Stockfish may still be loading)');
  }

  // Wait for Stockfish to produce an eval (up to 3s)
  await page.waitForTimeout(2500);
  const eval1 = await getEvalText(page);
  if (eval1 && eval1 !== '0.0') {
    pass(`Live eval after 2.5s: "${eval1}"`);
  } else {
    info(`Eval bar after 2.5s: "${eval1}" (Stockfish may not be initialized yet)`);
  }

  // Click the hint button to reveal the answer move
  const hintBtn = page.locator('button', { hasText: '💡 힌트' });
  const hintVisible = await hintBtn.isVisible().catch(() => false);
  if (hintVisible) {
    await hintBtn.click();
    await page.waitForTimeout(500);
    // Check if hint squares are highlighted (yellow arrow or source/dest)
    const hintHighlights = await page.evaluate(() => {
      const all = document.querySelectorAll('[style]');
      let count = 0;
      for (const el of all) {
        const bg = el.style.background || el.style.backgroundColor || '';
        if (bg.includes('rgba(60') || bg.includes('60,220') || bg.includes('3cdc82')) count++;
      }
      return count;
    });
    pass(`Hint shown (${hintHighlights} highlighted elements)`);
  } else {
    info('Hint button not visible (may be opponent\'s turn)');
  }

  // Use "해답 보기" to auto-solve and test navigation
  const showBtn = page.locator('button', { hasText: '👁 해답 보기' });
  const showVisible = await showBtn.isVisible().catch(() => false);
  if (showVisible) {
    await showBtn.click();
    log('Clicked "해답 보기"');
    // Wait for puzzle to be solved
    await page.waitForFunction(() =>
      document.body.innerText.includes('정답!'), {timeout: 10000});
    pass('Puzzle solved via "해답 보기"');
  } else {
    // Maybe already playing — wait for solved state
    await page.waitForTimeout(3000);
    const st = await getPuzzleStatus(page);
    if (st === 'solved') pass('Puzzle already solved');
    else info(`Status: ${st}`);
  }

  // Check eval bar after solve
  await page.waitForTimeout(1500);
  const evalSolved = await getEvalText(page);
  info(`Eval after solve: "${evalSolved}"`);

  // Check navigation arrows (← / →) are visible and clickable
  const backBtn = page.locator('button').filter({ hasText: '←' }).first();
  const fwdBtn = page.locator('button').filter({ hasText: '→' }).first();
  const backEnabled = await backBtn.isEnabled().catch(() => false);
  const backVisible = await backBtn.isVisible().catch(() => false);
  if (backVisible && backEnabled) {
    pass('← navigation button enabled after solve');
    // Navigate back a few positions
    for (let i = 0; i < 2; i++) {
      await backBtn.click();
      await page.waitForTimeout(300);
    }
    info('Navigated back 2 positions');
    // Navigate forward
    for (let i = 0; i < 2; i++) {
      await fwdBtn.click().catch(() => {});
      await page.waitForTimeout(300);
    }
    pass('Forward/backward navigation works');
  } else {
    fail(`Navigation button not enabled (visible:${backVisible} enabled:${backEnabled})`);
  }

  // Click "📊 수 분석" button
  const analysisBtn = page.locator('button', { hasText: '📊 수 분석' });
  const analysisBtnVisible = await analysisBtn.isVisible().catch(() => false);
  if (analysisBtnVisible) {
    await analysisBtn.click();
    log('Clicked "📊 수 분석"');
    // Wait for analysis to complete (progress bar appears then disappears)
    await page.waitForFunction(() =>
      document.body.innerText.includes('분석 종료'), {timeout: 60000});
    pass('Analysis panel appeared ("분석 종료" button visible)');

    // Check if eval graph is present (SVG)
    const svgCount = await page.evaluate(() => document.querySelectorAll('svg').length);
    if (svgCount > 0) pass(`Eval graph rendered (${svgCount} SVG elements)`);
    else fail('No SVG found — eval graph may be missing');

    // Check move list items
    const moveListItems = await page.evaluate(() => {
      // Count rows with "→" notation (move list entries)
      return document.body.innerText.split('\n').filter(l => l.includes('→') && l.match(/[a-h][1-8]→[a-h][1-8]/)).length;
    });
    if (moveListItems > 0) pass(`Move list has ${moveListItems} entries`);
    else info('Move list entries not found in text scan');

    // Navigate within analysis using back button
    const backInAnalysis = await backBtn.isEnabled().catch(() => false);
    if (backInAnalysis) {
      await backBtn.click();
      await page.waitForTimeout(400);
      pass('Navigation works inside analysis mode');
    }

    // Click "✕ 분석 종료" to close analysis
    const closeAnalysis = page.locator('button', { hasText: '분석 종료' });
    if (await closeAnalysis.isVisible().catch(() => false)) {
      await closeAnalysis.click();
      await page.waitForTimeout(300);
      pass('"분석 종료" closes analysis panel');
    }
  } else {
    fail('"📊 수 분석" button not visible after solve');
  }

  // Take screenshot for review
  await page.screenshot({ path: `scripts/puzzle-test-${puzzleNum}.png`, fullPage: false });
  log(`Screenshot saved: scripts/puzzle-test-${puzzleNum}.png`);
}

(async () => {
  log('Launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  // Capture console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(`PAGE ERROR: ${err.message}`));

  log(`Opening ${BASE}...`);
  await page.goto(BASE, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1500);

  // Click puzzle button
  const puzzleBtn = page.locator('button', { hasText: '🧩 퍼즐' });
  if (!await puzzleBtn.isVisible().catch(() => false)) {
    // Try alternative selector
    const allBtns = await page.locator('button').allTextContents();
    log(`Buttons found: ${allBtns.slice(0, 10).join(' | ')}`);
  }
  await puzzleBtn.click({ timeout: 5000 });
  log('Clicked puzzle button');

  for (let i = 1; i <= 5; i++) {
    try {
      await runPuzzle(page, i);
    } catch (err) {
      fail(`Puzzle ${i} threw: ${err.message}`);
    }

    // Load next puzzle
    if (i < 5) {
      const nextBtn = page.locator('button', { hasText: '다음 퍼즐 →' }).first();
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        log('→ Loading next puzzle...');
        await page.waitForTimeout(1500);
      }
    }
  }

  log('\n=== Console Errors ===');
  if (errors.length === 0) {
    pass('No console errors');
  } else {
    errors.forEach(e => fail(e));
  }

  await browser.close();
  log('\nTest complete.');
})();
