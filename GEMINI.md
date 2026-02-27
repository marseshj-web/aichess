# AI Chess Project Analysis

## 1. Project Overview
This is a React-based chess application featuring an integrated AI engine. It uses **Vite** as the build tool and leverages **Stockfish** (via WebAssembly/Web Worker) as the primary engine, with a built-in JavaScript alpha-beta search as a fallback.

## 2. File Structure & Relationships
- **`index.html`**: The entry point of the application.
- **`src/main.jsx`**: Bootstraps the React application and renders the `ChessEngine` component.
- **`chess-stockfish-engine.jsx`**: The core component containing:
  - Chess board logic (move generation, legality checks, board state).
  - Built-in AI (Alpha-Beta, Iterative Deepening, PST evaluation).
  - Stockfish integration logic.
  - UI/UX implementation (React component).
- **`public/stockfish.js` & `public/stockfish.wasm`**: The Stockfish engine compiled for the web.
- **`package.json`**: Project dependencies (`react`, `react-dom`) and scripts.
- **`vite.config.js`**: Vite configuration for the React project. It includes critical security headers (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`) required to enable `SharedArrayBuffer`, allowing Stockfish to utilize multi-threading.

## 3. Stockfish Engine Integration Logic

The communication with Stockfish happens in `chess-stockfish-engine.jsx` using the **UCI (Universal Chess Interface)** protocol over a **Web Worker**.

### Key Flow:
1. **Worker Initialization**: 
   - A worker is created using `new Worker('/stockfish.js')` inside a `useEffect` hook.
   - It initializes the engine by sending `uci` and waiting for `uciok`, then `isready` and `readyok`.

2. **Communication (UCI Protocol)**:
   - **Position**: The current board state is converted to a FEN string using `boardToFEN()`.
   - **Command**: The engine receives the position via `position fen <FEN>`.
   - **Search**: The engine starts searching using `go depth <D> movetime <T>`.
   - **Skill Level**: `setoption name Skill Level value <N>` is used to adjust difficulty.

3. **Handling Output**:
   - The worker's `onmessage` handler listens for:
     - `info ... score cp <N>`: Current evaluation in centipawns.
     - `bestmove <MOVE>`: The final recommended move in UCI format (e.g., "e2e4").

4. **Integration with React**:
   - UCI moves are converted to internal move objects via `uciToMove()`.
   - The board state is updated using `applyMv()`, triggering a re-render.

## 4. Advanced Features
- **Opening Book**: High-difficulty modes query the **Lichess Opening Explorer API** for master-level moves in the early game.
- **Game Review**: Post-game analysis iterates through history, using Stockfish to classify moves (Best, Excellent, Blunder, etc.) and calculate accuracy.
- **Fallback AI**: A custom JavaScript-based engine provides a backup if the Web Worker fails to load.
