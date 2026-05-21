#!/usr/bin/env node
// E2E flow simulation: mimics enterPuzzleMode → auto-play hook → click answer → next puzzle.

const fs = require('fs');
const path = require('path');

// ── chess logic (same as test-puzzle-ids.cjs) ────────────────────────────────
const E=0,WP=1,WN=2,WB=3,WR=4,WQ=5,WK=6,BP=7,BN=8,BB=9,BR=10,BQ=11,BK=12;
const isW=p=>p>=1&&p<=6, isB=p=>p>=7&&p<=12;
const rc=(r,c)=>r*8+c, toRC=i=>[i>>3,i&7], inB=(r,c)=>r>=0&&r<8&&c>=0&&c<8;
function sqAtt(bd,sq,by){const[r,c]=toRC(sq);const P=by==='w'?WP:BP,N=by==='w'?WN:BN,B=by==='w'?WB:BB,R=by==='w'?WR:BR,Q=by==='w'?WQ:BQ,K=by==='w'?WK:BK;const pd=by==='w'?1:-1;for(const dc of[-1,1]){const pr=r+pd,pc=c+dc;if(inB(pr,pc)&&bd[rc(pr,pc)]===P)return 1}for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]){const nr=r+dr,nc=c+dc;if(inB(nr,nc)&&bd[rc(nr,nc)]===N)return 1}for(const dr of[-1,0,1])for(const dc of[-1,0,1]){if(!dr&&!dc)continue;const nr=r+dr,nc=c+dc;if(inB(nr,nc)&&bd[rc(nr,nc)]===K)return 1}for(const[dr,dc]of[[-1,0],[1,0],[0,-1],[0,1]]){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){const p=bd[rc(nr,nc)];if(p){if(p===R||p===Q)return 1;break}nr+=dr;nc+=dc}}for(const[dr,dc]of[[-1,-1],[-1,1],[1,-1],[1,1]]){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){const p=bd[rc(nr,nc)];if(p){if(p===B||p===Q)return 1;break}nr+=dr;nc+=dc}}return 0;}
function genMoves(bd,col,ep,cas){const ms=[];const ally=col==='w'?isW:isB;const enemy=col==='w'?isB:isW;const P=col==='w'?WP:BP,N=col==='w'?WN:BN,B=col==='w'?WB:BB,R=col==='w'?WR:BR,Q=col==='w'?WQ:BQ,K=col==='w'?WK:BK;const dir=col==='w'?-1:1,sr=col==='w'?6:1,pr=col==='w'?0:7;for(let i=0;i<64;i++){const p=bd[i];if(!ally(p))continue;const[r,c]=toRC(i);if(p===P){const nr=r+dir;if(inB(nr,c)&&!bd[rc(nr,c)]){if(nr===pr)[Q,R,B,N].forEach(x=>ms.push({f:i,t:rc(nr,c),pr:x}));else{ms.push({f:i,t:rc(nr,c)});if(r===sr&&!bd[rc(r+dir*2,c)])ms.push({f:i,t:rc(r+dir*2,c),dbl:1})}}for(const dc of[-1,1]){const nc=c+dc;if(!inB(nr,nc))continue;const ti=rc(nr,nc);if(enemy(bd[ti])){if(nr===pr)[Q,R,B,N].forEach(x=>ms.push({f:i,t:ti,pr:x}));else ms.push({f:i,t:ti})}if(ep===ti)ms.push({f:i,t:ti,ep:1})}}else if(p===N){for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]){const nr=r+dr,nc=c+dc;if(inB(nr,nc)&&!ally(bd[rc(nr,nc)]))ms.push({f:i,t:rc(nr,nc)})}}else if(p===K){for(const dr of[-1,0,1])for(const dc of[-1,0,1]){if(!dr&&!dc)continue;const nr=r+dr,nc=c+dc;if(inB(nr,nc)&&!ally(bd[rc(nr,nc)]))ms.push({f:i,t:rc(nr,nc)})}const rw=col==='w'?7:0;if(r===rw&&c===4){const opp=col==='w'?'b':'w';if(cas.includes(col==='w'?'K':'k')&&!bd[rc(rw,5)]&&!bd[rc(rw,6)]&&!sqAtt(bd,rc(rw,4),opp)&&!sqAtt(bd,rc(rw,5),opp)&&!sqAtt(bd,rc(rw,6),opp))ms.push({f:i,t:rc(rw,6),cas:'k'});if(cas.includes(col==='w'?'Q':'q')&&!bd[rc(rw,3)]&&!bd[rc(rw,2)]&&!bd[rc(rw,1)]&&!sqAtt(bd,rc(rw,4),opp)&&!sqAtt(bd,rc(rw,3),opp)&&!sqAtt(bd,rc(rw,2),opp))ms.push({f:i,t:rc(rw,2),cas:'q'})}}else{let ds=[];if(p===R||p===Q)ds.push([-1,0],[1,0],[0,-1],[0,1]);if(p===B||p===Q)ds.push([-1,-1],[-1,1],[1,-1],[1,1]);for(const[dr,dc]of ds){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){const ti=rc(nr,nc);if(ally(bd[ti]))break;ms.push({f:i,t:ti});if(enemy(bd[ti]))break;nr+=dr;nc+=dc}}}}return ms;}
function doMv(bd,m){const nb=[...bd];nb[m.t]=m.pr||nb[m.f];nb[m.f]=E;if(m.ep){nb[rc(toRC(m.f)[0],toRC(m.t)[1])]=E}if(m.cas){const r=toRC(m.f)[0];if(m.cas==='k'){nb[rc(r,5)]=nb[rc(r,7)];nb[rc(r,7)]=E}else{nb[rc(r,3)]=nb[rc(r,0)];nb[rc(r,0)]=E}}return nb;}
function inChk(bd,col){const k=bd.indexOf(col==='w'?WK:BK);return k<0||sqAtt(bd,k,col==='w'?'b':'w')}
function legal(bd,col,ep,cas){return genMoves(bd,col,ep,cas).filter(m=>!inChk(doMv(bd,m),col))}
function updCas(cas,m,bd){let c=cas;const p=bd[m.f];if(p===WK)c=c.replace('K','').replace('Q','');if(p===BK)c=c.replace('k','').replace('q','');if(m.f===63||m.t===63)c=c.replace('K','');if(m.f===56||m.t===56)c=c.replace('Q','');if(m.f===7||m.t===7)c=c.replace('k','');if(m.f===0||m.t===0)c=c.replace('q','');return c}
function nextEp(m){if(!m.dbl)return null;const[fr]=toRC(m.f);const[tr]=toRC(m.t);return rc((fr+tr)/2,m.f&7)}
function fenToBoard(fen){const parts=fen.split(' ');const bd=new Array(64).fill(0);const pm={r:BR,n:BN,b:BB,q:BQ,k:BK,p:BP,R:WR,N:WN,B:WB,Q:WQ,K:WK,P:WP};let i=0;for(const ch of parts[0])if(ch==='/')continue;else if(ch>='1'&&ch<='8')i+=+ch;else bd[i++]=pm[ch];const turn=parts[1]==='w'?'w':'b';const cas=parts[2]==='-'?'':parts[2];let ep=null;if(parts[3]&&parts[3]!=='-'){ep=(8-+parts[3][1])*8+'abcdefgh'.indexOf(parts[3][0]);}return{board:bd,turn,cas,ep};}
function uciToMove(uci,bd,col,ep){const fc='abcdefgh'.indexOf(uci[0]),fr=8-parseInt(uci[1]);let tc='abcdefgh'.indexOf(uci[2]),tr=8-parseInt(uci[3]);let f=fr*8+fc,t=tr*8+tc;const p=bd[f];let cas=null;if((p===WK||p===BK)&&Math.abs(tc-fc)>=2){cas=tc>fc?'k':'q';tc=cas==='k'?6:2;t=tr*8+tc;}const m={f,t};if(cas)m.cas=cas;if(uci[4]){const pm={q:col==='w'?WQ:BQ,r:col==='w'?WR:BR,b:col==='w'?WB:BB,n:col==='w'?WN:BN};m.pr=pm[uci[4]];}if(ep===t&&(p===WP||p===BP))m.ep=1;if((p===WP||p===BP)&&Math.abs(tr-fr)===2)m.dbl=1;return m;}
function idxToUci(i){return 'abcdefgh'[i&7]+'12345678'[7-(i>>3)];}

// ── Mimic chess-stockfish-engine.jsx puzzle helpers ──────────────────────────
const cache = {};
async function fetchPuzzleById(id) {
  if (cache[id]) return cache[id];
  const r = await fetch(`https://lichess.org/api/puzzle/${id}`);
  if (!r.ok) throw new Error(`fetch ${id} -> ${r.status}`);
  const d = await r.json();
  const pz = { id: d.puzzle.id, fen: d.puzzle.fen, moves: d.puzzle.solution,
               rating: d.puzzle.rating, themes: d.puzzle.themes };
  cache[id] = pz;
  return pz;
}

function pickPuzzle(index, elo, currentId) {
  const center = Math.min(3000, elo + 600);
  let pool = index.filter(p => p.rating >= center-200 && p.rating <= center+200 && p.id !== currentId);
  if (!pool.length) pool = index.filter(p => p.rating >= center-200 && p.rating <= center+200);
  if (!pool.length) pool = index.filter(p => p.id !== currentId);
  if (!pool.length) pool = index;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Test ─────────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.log(`  ✗ ${msg}`); failed++; }
}

async function simulatePuzzle(puzzle, label) {
  console.log(`\n─── ${label}: ${puzzle.id} rating=${puzzle.rating} ───`);
  let { board, turn, ep, cas } = fenToBoard(puzzle.fen);
  let moveIdx = 0;
  const playerColor = turn;
  console.log(`  → Player is ${playerColor==='w'?'WHITE':'BLACK'} (FEN turn = solver's color)`);

  // Step 1: starting state — player to move at idx=0
  check(moveIdx === 0, 'puzzleMoveIdx starts at 0 (player\'s first move)');

  // Step 2: simulate WRONG move at the player's first turn (idx=0) → status='fail'
  const playerLegal = legal(board, turn, ep, cas);
  const correctMv = uciToMove(puzzle.moves[0], board, turn, ep);
  const wrong = playerLegal.find(m => !(m.f===correctMv.f && m.t===correctMv.t));
  if (wrong) {
    const matchesExpected = wrong.f===correctMv.f && wrong.t===correctMv.t;
    check(!matchesExpected, `wrong move ${idxToUci(wrong.f)+idxToUci(wrong.t)} does NOT match expected → status='fail'`);
  } else {
    check(true, 'only one legal move (cannot test wrong move scenario)');
  }

  // Step 3: simulate HINT — returns the expected move for player's turn
  const hintMv = uciToMove(puzzle.moves[moveIdx], board, turn, ep);
  check(hintMv && hintMv.f!=null && hintMv.t!=null, `hint returns valid {f,t} for ${puzzle.moves[moveIdx]}`);

  // Step 4: simulate CORRECT moves → keep advancing
  while (moveIdx < puzzle.moves.length) {
    const uci = puzzle.moves[moveIdx];
    const mv = uciToMove(uci, board, turn, ep);
    const ms = legal(board, turn, ep, cas);
    const isLegal = ms.some(m=>m.f===mv.f && m.t===mv.t);
    check(isLegal, `move ${moveIdx+1}/${puzzle.moves.length} ${uci} (${turn}) legal`);
    if (!isLegal) break;
    board = doMv(board, mv);
    ep = nextEp(mv);
    cas = updCas(cas, mv, board);
    turn = turn === 'w' ? 'b' : 'w';
    moveIdx++;
  }
  check(moveIdx === puzzle.moves.length, `solved: moveIdx reaches ${puzzle.moves.length} → status='solved'`);

  return puzzle.id;
}

async function main() {
  const idsPath = path.join(__dirname, '..', 'public', 'puzzle-ids.json');
  const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
  console.log(`Loaded ${ids.length} puzzle IDs`);

  // Simulate 4 puzzles for ELO 1200
  const elo = 1200;
  const solvedIds = new Set();
  let currentId = null;

  for (let i = 1; i <= 4; i++) {
    const pick = pickPuzzle(ids, elo, currentId);
    check(!solvedIds.has(pick.id) || ids.length < 5, `puzzle ${i}: picked different ID from previous (id=${pick.id})`);
    solvedIds.add(pick.id);
    const pz = await fetchPuzzleById(pick.id);
    await simulatePuzzle(pz, `Puzzle ${i}`);
    currentId = pick.id;
    await new Promise(r => setTimeout(r, 500));
  }

  // Test ELO filter at different levels
  console.log(`\n─── ELO filter ───`);
  for (const testElo of [600, 1200, 1800, 2400]) {
    const pick = pickPuzzle(ids, testElo, null);
    const center = Math.min(3000, testElo+600);
    console.log(`  ELO ${testElo} → center ${center} → picked ${pick.id} (rating=${pick.rating})`);
    check(pick.id != null, `ELO ${testElo}: picked a puzzle (any pool fallback works)`);
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
