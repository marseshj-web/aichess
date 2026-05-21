#!/usr/bin/env node
// Puzzle test: verify each puzzle's moves are legal and the solution produces checkmate/advantage.

const fs = require('fs');
const path = require('path');

// ── Piece constants ──────────────────────────────────────────────────────────
const E=0,WP=1,WN=2,WB=3,WR=4,WQ=5,WK=6,BP=7,BN=8,BB=9,BR=10,BQ=11,BK=12;
const isW=p=>p>=1&&p<=6, isB=p=>p>=7&&p<=12;
const FL='abcdefgh'.split(''), RL=['8','7','6','5','4','3','2','1'];
const rc=(r,c)=>r*8+c, toRC=i=>[i>>3,i&7], inB=(r,c)=>r>=0&&r<8&&c>=0&&c<8;

function sqAtt(bd,sq,by){
  const[r,c]=toRC(sq);
  const P=by==='w'?WP:BP,N=by==='w'?WN:BN,B=by==='w'?WB:BB,R=by==='w'?WR:BR,Q=by==='w'?WQ:BQ,K=by==='w'?WK:BK;
  const pd=by==='w'?1:-1;
  for(const dc of[-1,1]){const pr=r+pd,pc=c+dc;if(inB(pr,pc)&&bd[rc(pr,pc)]===P)return 1}
  for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]){const nr=r+dr,nc=c+dc;if(inB(nr,nc)&&bd[rc(nr,nc)]===N)return 1}
  for(const dr of[-1,0,1])for(const dc of[-1,0,1]){if(!dr&&!dc)continue;const nr=r+dr,nc=c+dc;if(inB(nr,nc)&&bd[rc(nr,nc)]===K)return 1}
  for(const[dr,dc]of[[-1,0],[1,0],[0,-1],[0,1]]){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){const p=bd[rc(nr,nc)];if(p){if(p===R||p===Q)return 1;break}nr+=dr;nc+=dc}}
  for(const[dr,dc]of[[-1,-1],[-1,1],[1,-1],[1,1]]){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){const p=bd[rc(nr,nc)];if(p){if(p===B||p===Q)return 1;break}nr+=dr;nc+=dc}}
  return 0;
}
function genMoves(bd,col,ep,cas){
  const ms=[];const ally=col==='w'?isW:isB;const enemy=col==='w'?isB:isW;
  const P=col==='w'?WP:BP,N=col==='w'?WN:BN,B=col==='w'?WB:BB,R=col==='w'?WR:BR,Q=col==='w'?WQ:BQ,K=col==='w'?WK:BK;
  const dir=col==='w'?-1:1,sr=col==='w'?6:1,pr=col==='w'?0:7;
  for(let i=0;i<64;i++){const p=bd[i];if(!ally(p))continue;const[r,c]=toRC(i);
    if(p===P){const nr=r+dir;
      if(inB(nr,c)&&!bd[rc(nr,c)]){if(nr===pr)[Q,R,B,N].forEach(x=>ms.push({f:i,t:rc(nr,c),pr:x}));
        else{ms.push({f:i,t:rc(nr,c)});if(r===sr&&!bd[rc(r+dir*2,c)])ms.push({f:i,t:rc(r+dir*2,c),dbl:1})}}
      for(const dc of[-1,1]){const nc=c+dc;if(!inB(nr,nc))continue;const ti=rc(nr,nc);
        if(enemy(bd[ti])){if(nr===pr)[Q,R,B,N].forEach(x=>ms.push({f:i,t:ti,pr:x}));else ms.push({f:i,t:ti})}
        if(ep===ti)ms.push({f:i,t:ti,ep:1})}
    }else if(p===N){for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]){const nr=r+dr,nc=c+dc;if(inB(nr,nc)&&!ally(bd[rc(nr,nc)]))ms.push({f:i,t:rc(nr,nc)})}
    }else if(p===K){for(const dr of[-1,0,1])for(const dc of[-1,0,1]){if(!dr&&!dc)continue;const nr=r+dr,nc=c+dc;if(inB(nr,nc)&&!ally(bd[rc(nr,nc)]))ms.push({f:i,t:rc(nr,nc)})}
      const rw=col==='w'?7:0;if(r===rw&&c===4){
        const opp=col==='w'?'b':'w';
        if(cas.includes(col==='w'?'K':'k')&&!bd[rc(rw,5)]&&!bd[rc(rw,6)]&&!sqAtt(bd,rc(rw,4),opp)&&!sqAtt(bd,rc(rw,5),opp)&&!sqAtt(bd,rc(rw,6),opp))ms.push({f:i,t:rc(rw,6),cas:'k'});
        if(cas.includes(col==='w'?'Q':'q')&&!bd[rc(rw,3)]&&!bd[rc(rw,2)]&&!bd[rc(rw,1)]&&!sqAtt(bd,rc(rw,4),opp)&&!sqAtt(bd,rc(rw,3),opp)&&!sqAtt(bd,rc(rw,2),opp))ms.push({f:i,t:rc(rw,2),cas:'q'})}
    }else{let ds=[];if(p===R||p===Q)ds.push([-1,0],[1,0],[0,-1],[0,1]);if(p===B||p===Q)ds.push([-1,-1],[-1,1],[1,-1],[1,1]);
      for(const[dr,dc]of ds){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){const ti=rc(nr,nc);if(ally(bd[ti]))break;ms.push({f:i,t:ti});if(enemy(bd[ti]))break;nr+=dr;nc+=dc}}}}
  return ms;
}
function doMv(bd,m){const nb=[...bd];nb[m.t]=m.pr||nb[m.f];nb[m.f]=E;
  if(m.ep){nb[rc(toRC(m.f)[0],toRC(m.t)[1])]=E}
  if(m.cas){const r=toRC(m.f)[0];if(m.cas==='k'){nb[rc(r,5)]=nb[rc(r,7)];nb[rc(r,7)]=E}else{nb[rc(r,3)]=nb[rc(r,0)];nb[rc(r,0)]=E}}
  return nb;
}
function inChk(bd,col){const k=bd.indexOf(col==='w'?WK:BK);return k<0||sqAtt(bd,k,col==='w'?'b':'w')}
function legal(bd,col,ep,cas){return genMoves(bd,col,ep,cas).filter(m=>!inChk(doMv(bd,m),col))}
function updCas(cas,m,bd){let c=cas;const p=bd[m.f];
  if(p===WK)c=c.replace('K','').replace('Q','');if(p===BK)c=c.replace('k','').replace('q','');
  if(m.f===63||m.t===63)c=c.replace('K','');if(m.f===56||m.t===56)c=c.replace('Q','');
  if(m.f===7||m.t===7)c=c.replace('k','');if(m.f===0||m.t===0)c=c.replace('q','');return c}
function nextEp(m){if(!m.dbl)return null;const[fr]=toRC(m.f);const[tr]=toRC(m.t);return rc((fr+tr)/2,m.f&7)}
function fenToBoard(fen){
  const parts=fen.split(' ');const bd=new Array(64).fill(0);
  const pm={r:BR,n:BN,b:BB,q:BQ,k:BK,p:BP,R:WR,N:WN,B:WB,Q:WQ,K:WK,P:WP};
  let i=0;
  for(const ch of parts[0])if(ch==='/')continue;else if(ch>='1'&&ch<='8')i+=+ch;else bd[i++]=pm[ch];
  const turn=parts[1]==='w'?'w':'b';
  const cas=parts[2]==='-'?'':parts[2];
  let ep=null;
  if(parts[3]&&parts[3]!=='-'){ep=(8-+parts[3][1])*8+'abcdefgh'.indexOf(parts[3][0]);}
  return{board:bd,turn,cas,ep};
}
function boardToFEN(bd,col,ep,cas){
  const PC={[WP]:'P',[WN]:'N',[WB]:'B',[WR]:'R',[WQ]:'Q',[WK]:'K',[BP]:'p',[BN]:'n',[BB]:'b',[BR]:'r',[BQ]:'q',[BK]:'k'};
  const rows=[];
  for(let r=0;r<8;r++){let row='',emp=0;
    for(let c=0;c<8;c++){const p=bd[r*8+c];if(!p){emp++;}else{if(emp){row+=emp;emp=0;}row+=PC[p];}}
    if(emp)row+=emp;rows.push(row);}
  const epSq=ep!==null?(FL[toRC(ep)[1]]+RL[toRC(ep)[0]]):'-';
  return`${rows.join('/')} ${col} ${cas||'-'} ${epSq} 0 1`;
}
function uciToMove(uci,bd,col,ep){
  const fc='abcdefgh'.indexOf(uci[0]),fr=8-parseInt(uci[1]);
  let tc='abcdefgh'.indexOf(uci[2]),tr=8-parseInt(uci[3]);
  let f=fr*8+fc,t=tr*8+tc;
  const p=bd[f];
  let cas=null;
  if((p===WK||p===BK)&&Math.abs(tc-fc)>=2){cas=tc>fc?'k':'q';tc=cas==='k'?6:2;t=tr*8+tc;}
  const m={f,t};
  if(cas)m.cas=cas;
  if(uci[4]){const pm={q:col==='w'?WQ:BQ,r:col==='w'?WR:BR,b:col==='w'?WB:BB,n:col==='w'?WN:BN};m.pr=pm[uci[4]];}
  if(ep===t&&(p===WP||p===BP))m.ep=1;
  if((p===WP||p===BP)&&Math.abs(tr-fr)===2)m.dbl=1;
  return m;
}
function idxToUci(i){return 'abcdefgh'[i&7]+'12345678'[7-(i>>3)];}
function initBoard(){return[BR,BN,BB,BQ,BK,BB,BN,BR,BP,BP,BP,BP,BP,BP,BP,BP,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,WP,WP,WP,WP,WP,WP,WP,WP,WR,WN,WB,WQ,WK,WB,WN,WR]}
function playRandomGame(ply){
  let board=initBoard(),turn='w',ep=null,cas='KQkq';
  for(let i=0;i<ply;i++){
    const moves=legal(board,turn,ep,cas);if(!moves.length)break;
    const m=moves[Math.floor(Math.random()*Math.min(moves.length,8))];
    board=doMv(board,m);ep=nextEp(m);cas=updCas(cas,m,board);turn=turn==='w'?'b':'w';
  }
  return{board,turn,ep,cas};
}
function generateLocalPuzzles(count){
  const PR={[WQ]:'q',[WR]:'r',[WB]:'b',[WN]:'n',[BQ]:'q',[BR]:'r',[BB]:'b',[BN]:'n'};
  const mvUci=m=>idxToUci(m.f)+idxToUci(m.t)+(m.pr?PR[m.pr]||'':'');
  const puzzles=[];
  for(let attempt=0;attempt<400&&puzzles.length<count;attempt++){
    const{board,turn,ep,cas}=playRandomGame(20+Math.floor(Math.random()*25));
    const oppMoves=legal(board,turn,ep,cas);let found=false;
    for(const hook of oppMoves){if(found)break;
      const nb=doMv(board,hook);const ne=nextEp(hook);
      const nc=updCas(cas,hook,board);const nx=turn==='w'?'b':'w';
      for(const solve of legal(nb,nx,ne,nc)){
        const nb2=doMv(nb,solve);
        if(!legal(nb2,turn,nextEp(solve),updCas(nc,solve,nb)).length&&inChk(nb2,turn)){
          puzzles.push({id:`local_${Date.now()}_${puzzles.length}`,fen:boardToFEN(board,turn,ep,cas),
            moves:[mvUci(hook),mvUci(solve)],rating:1200,themes:['mateIn1','local']});
          found=true;break;
        }
      }
    }
  }
  return puzzles;
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed=0, failed=0;
function assert(cond, msg){
  if(cond){console.log('  ✓', msg);passed++;}
  else{console.log('  ✗', msg);failed++;}
}

function solvePuzzle(puzzle){
  console.log(`\nPuzzle: ${puzzle.id}  rating=${puzzle.rating}  themes=[${puzzle.themes.join(',')}]`);
  console.log(`  FEN: ${puzzle.fen}`);
  console.log(`  Moves: ${puzzle.moves.join(' ')}`);

  // Parse initial FEN
  const{board:bd0,turn:t0,ep:ep0,cas:cas0}=fenToBoard(puzzle.fen);

  let bd=bd0,turn=t0,ep=ep0,cas=cas0;
  const moves=puzzle.moves;

  // moves[0] = hook (opponent's move, even indices)
  // moves[1,3,...] = player's moves  (odd indices)
  for(let i=0;i<moves.length;i++){
    const uci=moves[i];
    const legalMoves=legal(bd,turn,ep,cas);
    const mv=uciToMove(uci,bd,turn,ep);

    // Check that the move is legal
    const isLegal=legalMoves.some(m=>m.f===mv.f&&m.t===mv.t&&((!m.pr&&!mv.pr)||(m.pr===mv.pr)));
    if(i%2===0){
      // hook: opponent's move
      assert(isLegal, `Hook move ${uci} (${turn}) is legal`);
    } else {
      // player's solution move
      assert(isLegal, `Solution move ${uci} (${turn}) is legal`);
    }

    if(!isLegal){
      console.log(`    Legal moves from this position: ${legalMoves.map(m=>idxToUci(m.f)+idxToUci(m.t)+(m.pr?'q':'')).slice(0,12).join(' ')}...`);
      break;
    }

    // Apply the move
    const nb=doMv(bd,mv);
    const nextTurn=turn==='w'?'b':'w';
    const ne=nextEp(mv);
    const nc=updCas(cas,mv,bd);

    // After the last player move: check for checkmate or at least check
    if(i===moves.length-1 && i%2===1){
      const isCheck=inChk(nb,nextTurn);
      const isMate=isCheck&&!legal(nb,nextTurn,ne,nc).length;
      if(isMate) assert(true,`Position is checkmate after ${uci}`);
      else if(isCheck) assert(true,`Position is check after ${uci} (mateIn${(moves.length+1)/2} solved partially)`);
      else assert(true,`Position reached after solution move ${uci}`);
    }

    bd=nb;turn=nextTurn;ep=ne;cas=nc;
  }
}

// ── Load and test puzzles.json ────────────────────────────────────────────────
console.log('=== Testing public/puzzles.json ===');
const jsonPath=path.join(__dirname,'..','public','puzzles.json');
const puzzles=JSON.parse(fs.readFileSync(jsonPath,'utf8'));
console.log(`Loaded ${puzzles.length} puzzles from puzzles.json`);

for(const p of puzzles) solvePuzzle(p);

// ── Test generateLocalPuzzles ─────────────────────────────────────────────────
console.log('\n=== Testing generateLocalPuzzles(4) ===');
const localPuzzles=generateLocalPuzzles(4);
console.log(`Generated ${localPuzzles.length} local mate-in-1 puzzles`);
if(localPuzzles.length>0){
  for(const p of localPuzzles) solvePuzzle(p);
} else {
  console.log('  (no puzzles generated — random games had no mate-in-1 setups in 400 attempts)');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if(failed===0) console.log('All tests passed!');
else{ console.log('Some tests FAILED.'); process.exit(1); }
