# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (localhost:5173)
npm run build    # Production build
npm run preview  # Preview production build
```

No test framework is configured.

## Architecture

This is a single-page React + Vite chess application. The entire game logic and UI lives in one file: **`chess-stockfish-engine.jsx`**, which is imported by `src/main.jsx` as the root component.

### Engine Hierarchy

The AI uses **two engines in priority order**:

1. **Stockfish WASM** (primary) — loaded as a Web Worker from `/public/stockfish.js` + `/public/stockfish.wasm`. Communicates via UCI protocol over `postMessage`. Skill level is mapped per difficulty via `DIFFS[].skill`.
2. **Built-in alpha-beta engine** (fallback) — used when Stockfish is not yet ready (`sfReadyRef.current === false`). Implements iterative deepening, alpha-beta pruning, quiescence search, MVV-LVA move ordering, and late move reduction.

### Key Data Structures

- **Board**: flat 64-element integer array (index `r*8+c`). Piece constants: `E=0, WP=1…WK=6, BP=7…BK=12`.
- **Move object**: `{f, t, pr?, ep?, cas?, dbl?}` — from/to square indices, optional promotion piece, en-passant flag, castling side, double-pawn flag.
- **Game state** (React state): `board`, `turn` (`'w'`/`'b'`), `ep` (en-passant target square or null), `cas` (castling rights string e.g. `'KQkq'`), `sel`, `lm` (legal moves for selected piece), `over`, `promo`, `hist`, `capW`/`capB`, `elo` (player-selected AI rating, 600–2400).

### COOP/COEP Headers Requirement

Stockfish WASM requires `SharedArrayBuffer`, which needs these headers on every response:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

These are set in both `vite.config.js` (dev server) and `vercel.json` (production deployment).

### Difficulty System

`DIFFS[]` (19 levels, ELO 600–2400) maps each difficulty to `depth`, `time` (ms), `rand` (centipawn noise), and `skill` (UCI Skill Level 0–20). The user selects an `elo` value, which is matched to the nearest `DIFFS` entry at runtime.

### FEN / UCI Conversion

`boardToFEN()` converts internal board state → FEN string for Stockfish input. `uciToMove()` parses Stockfish's UCI move response back into an internal move object, inferring en-passant, castling, and promotion flags from board context.

### Refreshing the Puzzle Pool

The app loads puzzle IDs from `public/puzzle-ids.json` and lazily fetches each puzzle's FEN + solution from `https://lichess.org/api/puzzle/{id}` at runtime. Responses are cached in `localStorage` (`aichess_puzzle_cache_v1`).

**Recommended (CSV-based, ~1500 puzzles, all ELO bands):**
1. Download `lichess_db_puzzle.csv.zst` from https://database.lichess.org/#puzzles (~650 MB compressed)
2. Decompress to `lichess_db_puzzle.csv` (~3 GB)
   - Windows: `choco install zstandard` then `zstd -d lichess_db_puzzle.csv.zst`, or use 7-Zip
   - macOS/Linux: `zstd -d lichess_db_puzzle.csv.zst`
3. Run: `node scripts/generate-puzzles.cjs /path/to/lichess_db_puzzle.csv`
   → Overwrites `public/puzzle-ids.json` with 1500 curated puzzles (250 per ELO band, filtered by `plays ≥ 500`, `rd ≤ 200`)

**Fallback (HTML scraping, ~100 puzzles, no CSV download):**
- `npm run puzzles` — scrapes Lichess `/training`. Slow, heavily rate-limited, ELO-biased toward 1300–1600.
