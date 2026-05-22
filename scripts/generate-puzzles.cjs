#!/usr/bin/env node
/**
 * generate-puzzles.js
 *
 * Generates public/puzzle-ids.json from the Lichess puzzle CSV database.
 * The app loads metadata (id/rating/themes) from this file and lazily fetches
 * each puzzle's FEN + solution from https://lichess.org/api/puzzle/{id} at runtime.
 *
 * Usage:
 *   node scripts/generate-puzzles.js /path/to/lichess_db_puzzle.csv
 *
 * Download the CSV from: https://database.lichess.org/#puzzles
 * (~650MB compressed, ~3GB uncompressed)
 *
 * Output: public/puzzle-ids.json (~150 KB, ~1500 curated puzzle IDs)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CSV_PATH = process.argv[2];
const OUT_PATH = path.join(__dirname, '..', 'public', 'puzzle-ids.json');

if (!CSV_PATH) {
  console.error('Usage: node scripts/generate-puzzles.js <path-to-puzzles.csv>');
  process.exit(1);
}

// Rating bands to sample from (250 puzzles each = 1750 total)
// ELO mapping: center = min(3000, elo + 600), range ±200
// ELO 600  → puzzle ~1200 ± 200 → covers bands 1000-1400
// ELO 1200 → puzzle ~1800 ± 200 → covers bands 1600-2000
// ELO 2400 → puzzle ~3000 ± 200 → covers bands 2800-3000 (capped)
const BANDS = [
  [900,  1200],
  [1200, 1500],
  [1500, 1800],
  [1800, 2100],
  [2100, 2500],
  [2500, 3000],
];
const PER_BAND = 250;

// Quality filters
const MIN_PLAYS    = 500;  // well-tested puzzles
const MIN_POPULARITY = 0;  // not disliked
const MAX_RD       = 200;  // stable rating (low uncertainty)

const buckets = {};
for (const [lo, hi] of BANDS) {
  buckets[`${lo}-${hi}`] = { lo, hi, items: [], count: 0 };
}

const rl = readline.createInterface({ input: fs.createReadStream(CSV_PATH) });
let header = null;
let lineNum = 0;
let accepted = 0;

rl.on('line', (line) => {
  lineNum++;
  if (lineNum === 1) { header = line.split(','); return; }

  const cols = line.split(',');
  if (cols.length < 10) return;

  const id          = cols[0];
  const fen         = cols[1];
  const movesRaw    = cols[2];
  const rating      = parseInt(cols[3]);
  const rd          = parseInt(cols[4]);
  const popularity  = parseInt(cols[5]);
  const nbPlays     = parseInt(cols[6]);
  const themes      = cols[7] ? cols[7].split(' ').filter(Boolean) : [];

  if (isNaN(rating) || isNaN(rd) || isNaN(popularity) || isNaN(nbPlays)) return;
  if (nbPlays < MIN_PLAYS) return;
  if (popularity < MIN_POPULARITY) return;
  if (rd > MAX_RD) return;

  // Quick sanity check that the CSV row has a solution; we don't store it
  // (full puzzle data is fetched per-id at runtime from the Lichess API).
  const moves = movesRaw.trim().split(' ').filter(Boolean);
  if (moves.length < 2) return; // need at least hook + 1 player move

  // Find the right band
  for (const key of Object.keys(buckets)) {
    const b = buckets[key];
    if (rating >= b.lo && rating < b.hi) {
      b.count++;
      // Reservoir sampling: keep a random sample of PER_BAND
      if (b.items.length < PER_BAND) {
        b.items.push({ id, rating, themes, hook: moves[0] });
      } else {
        const j = Math.floor(Math.random() * b.count);
        if (j < PER_BAND) {
          b.items[j] = { id, rating, themes, hook: moves[0] };
        }
      }
      break;
    }
  }

  accepted++;
  if (lineNum % 500000 === 0) {
    const totals = Object.values(buckets).map(b => b.items.length).join(', ');
    console.log(`Processed ${(lineNum/1e6).toFixed(1)}M lines | accepted ${accepted} | band counts: [${totals}]`);
  }
});

rl.on('close', () => {
  const all = [];
  for (const b of Object.values(buckets)) {
    all.push(...b.items);
    console.log(`Band ${b.lo}-${b.hi}: ${b.items.length} puzzles (from ${b.count} candidates)`);
  }

  // Shuffle output
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(all));
  console.log(`\nWrote ${all.length} puzzle IDs to ${OUT_PATH}`);
  const sizeKb = fs.statSync(OUT_PATH).size / 1024;
  console.log(`File size: ${sizeKb < 1024 ? sizeKb.toFixed(1) + ' KB' : (sizeKb / 1024).toFixed(2) + ' MB'}`);
});
