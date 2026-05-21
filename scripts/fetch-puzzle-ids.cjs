#!/usr/bin/env node
/**
 * fetch-puzzle-ids.cjs
 *
 * Lichess 퍼즐 ID 수집기.
 *
 * 전략: https://lichess.org/training 페이지는 매번 다른 랜덤 valid 퍼즐을 반환.
 * HTML 안에 puzzle JSON({id, rating, plays, solution, themes, initialPly})이 임베드되어 있음.
 * → 페이지를 여러 번 fetch해서 id/rating/themes만 추출하면 100% hit rate.
 *
 * Usage: node scripts/fetch-puzzle-ids.cjs [target]
 *   target: 수집할 유효 퍼즐 개수 (기본 250)
 */

const fs = require('fs');
const path = require('path');

const TARGET = parseInt(process.argv[2]) || 250;
const CONCURRENCY = 6;
const BATCH_DELAY_MS = 400;
const OUT_PATH = path.join(__dirname, '..', 'public', 'puzzle-ids.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let rateLimitedUntil = 0;
let consecutive429 = 0;

async function fetchRandomPuzzle() {
  if (Date.now() < rateLimitedUntil) await sleep(rateLimitedUntil - Date.now());
  try {
    const r = await fetch('https://lichess.org/training', {
      headers: { 'User-Agent': 'aichess-puzzle-collector/1.0', 'Accept': 'text/html' }
    });
    if (r.status === 429) {
      consecutive429++;
      const wait = Math.min(60000, 5000 * consecutive429);
      rateLimitedUntil = Date.now() + wait;
      console.log(`  [429 rate-limited, sleeping ${wait}ms]`);
      return null;
    }
    consecutive429 = 0;
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/"puzzle":\{[^}]+\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0].slice(m[0].indexOf('{')));
    if (!obj?.id || !obj?.rating || !Array.isArray(obj?.themes)) return null;
    return { id: obj.id, rating: obj.rating, themes: obj.themes };
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log(`Target: ${TARGET} valid puzzles  Concurrency: ${CONCURRENCY}`);
  console.log(`Strategy: fetch https://lichess.org/training (random puzzle per request)`);
  const seenIds = new Set();
  const valid = [];
  let requests = 0;
  const startTime = Date.now();

  while (valid.length < TARGET) {
    const batch = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => fetchRandomPuzzle())
    );
    requests += CONCURRENCY;
    for (const r of batch) {
      if (r && !seenIds.has(r.id)) {
        seenIds.add(r.id);
        valid.push(r);
      }
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`  requests=${requests}  unique=${valid.length}  elapsed=${elapsed}s`);
    // Incremental save every batch — survives kill/interrupt
    fs.writeFileSync(OUT_PATH, JSON.stringify([...valid].sort((a,b)=>a.rating-b.rating)));
    if (valid.length >= TARGET) break;
    await sleep(BATCH_DELAY_MS);
  }

  valid.sort((a, b) => a.rating - b.rating);
  fs.writeFileSync(OUT_PATH, JSON.stringify(valid));
  const sizeKb = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
  console.log(`\nWrote ${valid.length} puzzle IDs to ${OUT_PATH} (${sizeKb} KB)`);

  const bands = [[0,1000],[1000,1300],[1300,1600],[1600,1900],[1900,2200],[2200,2500],[2500,9999]];
  console.log('\nELO distribution:');
  for (const [lo, hi] of bands) {
    const n = valid.filter(p => p.rating >= lo && p.rating < hi).length;
    console.log(`  ${lo}-${hi}: ${n}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
