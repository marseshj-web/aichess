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

1. **Stockfish WASM** (primary) — loaded as a Web Worker from `/public/stockfish.js` + `/public/stockfish.wasm`. Communicates via UCI protocol over `postMessage`. Skill level is mapped per difficulty via `SF_SKILL[]`.
2. **Built-in alpha-beta engine** (fallback) — used when Stockfish is not yet ready (`sfReadyRef.current === false`). Implements iterative deepening, alpha-beta pruning, quiescence search, MVV-LVA move ordering, and late move reduction.

### Key Data Structures

- **Board**: flat 64-element integer array (index `r*8+c`). Piece constants: `E=0, WP=1…WK=6, BP=7…BK=12`.
- **Move object**: `{f, t, pr?, ep?, cas?, dbl?}` — from/to square indices, optional promotion piece, en-passant flag, castling side, double-pawn flag.
- **Game state** (React state): `board`, `turn` (`'w'`/`'b'`), `ep` (en-passant target square or null), `cas` (castling rights string e.g. `'KQkq'`), `sel`, `lm` (legal moves for selected piece), `over`, `promo`, `hist`, `capW`/`capB`.

### COOP/COEP Headers Requirement

Stockfish WASM requires `SharedArrayBuffer`, which needs these headers on every response:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

These are set in both `vite.config.js` (dev server) and `vercel.json` (production deployment).

### Difficulty System

`DIFFS[]` (10 levels, index `di`) controls `depth`, `time` (ms), and `rand` (centipawn noise) for both engines. Stockfish additionally uses `SF_SKILL[]` to set UCI Skill Level (0–20).

### FEN / UCI Conversion

`boardToFEN()` converts internal board state → FEN string for Stockfish input. `uciToMove()` parses Stockfish's UCI move response back into an internal move object, inferring en-passant, castling, and promotion flags from board context.
