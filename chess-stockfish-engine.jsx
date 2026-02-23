import { useState, useCallback, useEffect, useRef } from "react";

// ═══════════════════════════════════════════════════
// PIECE CONSTANTS
// ═══════════════════════════════════════════════════
const E=0,WP=1,WN=2,WB=3,WR=4,WQ=5,WK=6,BP=7,BN=8,BB=9,BR=10,BQ=11,BK=12;
const SYM={[WP]:'♟',[WN]:'♞',[WB]:'♝',[WR]:'♜',[WQ]:'♛',[WK]:'♚',
  [BP]:'♟',[BN]:'♞',[BB]:'♝',[BR]:'♜',[BQ]:'♛',[BK]:'♚'};
const isW=p=>p>=1&&p<=6, isB=p=>p>=7&&p<=12;
const MAT_VAL={[WP]:1,[WN]:3,[WB]:3,[WR]:5,[WQ]:9,[WK]:0,[BP]:1,[BN]:3,[BB]:3,[BR]:5,[BQ]:9,[BK]:0};
const mv=p=>MAT_VAL[p]||0;
const FL='abcdefgh'.split(''),RL=['8','7','6','5','4','3','2','1'];

// Engine piece values (centipawns)
const EV=[0,100,320,330,500,900,20000,100,320,330,500,900,20000];

// ═══════════════════════════════════════════════════
// PIECE-SQUARE TABLES (White perspective, index 0=a8)
// ═══════════════════════════════════════════════════
const T={
[WP]:[0,0,0,0,0,0,0,0, 80,80,80,80,80,80,80,80, 25,30,35,40,40,35,30,25, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 5,-5,-5,5,5,-5,-5,5, 5,10,10,-25,-25,10,10,5, 0,0,0,0,0,0,0,0],
[WN]:[-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,5,5,0,-20,-40, -30,5,15,20,20,15,5,-30, -30,0,20,25,25,20,0,-30, -30,5,15,20,20,15,5,-30, -30,0,10,15,15,10,0,-30, -40,-20,0,0,0,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
[WB]:[-20,-10,-10,-10,-10,-10,-10,-20, -10,5,0,0,0,0,5,-10, -10,10,10,10,10,10,10,-10, -10,0,10,15,15,10,0,-10, -10,5,10,15,15,10,5,-10, -10,0,5,10,10,5,0,-10, -10,0,0,0,0,0,0,-10, -20,-10,-10,-10,-10,-10,-10,-20],
[WR]:[5,5,5,5,5,5,5,5, 10,15,15,15,15,15,15,10, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,5,5,0,0,-5, 0,0,5,10,10,5,0,0],
[WQ]:[-20,-10,-10,-5,-5,-10,-10,-20, -10,0,5,0,0,0,0,-10, -10,5,5,5,5,5,0,-10, 0,0,5,5,5,5,0,-5, -5,0,5,5,5,5,0,-5, -10,0,5,5,5,5,0,-10, -10,0,0,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
[WK]:[-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
};
// King endgame table
const WK_END=[-50,-30,-30,-30,-30,-30,-30,-50, -30,-10,0,0,0,0,-10,-30, -30,0,10,15,15,10,0,-30, -30,0,15,20,20,15,0,-30, -30,0,15,20,20,15,0,-30, -30,0,10,15,15,10,0,-30, -30,-10,0,0,0,0,-10,-30, -50,-30,-30,-30,-30,-30,-30,-50];

// Mirror for black
for(let bp=BP;bp<=BK;bp++){const wp=bp-6;if(T[wp]){T[bp]=[];for(let r=7;r>=0;r--)for(let c=0;c<8;c++)T[bp].push(T[wp][r*8+c])}}
const BK_END=[];for(let r=7;r>=0;r--)for(let c=0;c<8;c++)BK_END.push(WK_END[r*8+c]);

// ═══════════════════════════════════════════════════
// BOARD LOGIC
// ═══════════════════════════════════════════════════
function initBoard(){return[BR,BN,BB,BQ,BK,BB,BN,BR,BP,BP,BP,BP,BP,BP,BP,BP,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,WP,WP,WP,WP,WP,WP,WP,WP,WR,WN,WB,WQ,WK,WB,WN,WR]}
const rc=(r,c)=>r*8+c, toRC=i=>[i>>3,i&7], inB=(r,c)=>r>=0&&r<8&&c>=0&&c<8;

function sqAtt(bd,sq,by){
  const[r,c]=toRC(sq);const P=by==='w'?WP:BP,N=by==='w'?WN:BN,B=by==='w'?WB:BB,R=by==='w'?WR:BR,Q=by==='w'?WQ:BQ,K=by==='w'?WK:BK;
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

// ═══════════════════════════════════════════════════
// ENHANCED AI ENGINE
// Iterative deepening + Alpha-Beta + Quiescence
// ═══════════════════════════════════════════════════
let nodeCount=0;

function evaluate(bd){
  let mg=0, eg=0, phase=0;
  const phaseInc=[0,0,1,1,2,4,0,0,1,1,2,4,0];
  let wMat=0, bMat=0;
  for(let i=0;i<64;i++){
    const p=bd[i]; if(!p)continue;
    const v=EV[p];
    const pst=T[p]?T[p][i]:0;
    if(isW(p)){mg+=v+pst; wMat+=v}
    else{mg-=v+pst; bMat+=v}
    phase+=phaseInc[p];
  }
  // King endgame PST blending
  const wki=bd.indexOf(WK), bki=bd.indexOf(BK);
  if(wki>=0){const egBonus=WK_END[wki]-T[WK][wki]; eg=egBonus}
  if(bki>=0){const egBonus=BK_END[bki]-T[BK][bki]; eg-=egBonus}
  // Bishop pair bonus
  let wb=0,bb=0;for(let i=0;i<64;i++){if(bd[i]===WB)wb++;if(bd[i]===BB)bb++}
  if(wb>=2)mg+=30;if(bb>=2)mg-=30;
  // Phase interpolation (24 = opening, 0 = endgame)
  phase=Math.min(phase,24);
  const score=mg + Math.round(eg*(24-phase)/24);
  return score;
}

// MVV-LVA move ordering
function scoreMove(bd,m){
  let s=0;
  const victim=bd[m.t]; const attacker=bd[m.f];
  if(victim) s += EV[victim]*10 - EV[attacker]; // MVV-LVA
  if(m.pr) s += EV[m.pr];
  if(m.ep) s += 900;
  // Penalize moving to attacked square
  return s;
}

function orderMoves(bd,ms){
  const scored=ms.map(m=>({m,s:scoreMove(bd,m)}));
  scored.sort((a,b)=>b.s-a.s);
  return scored.map(x=>x.m);
}

// Quiescence search - only captures
function quiesce(bd,alpha,beta,col,depth){
  nodeCount++;
  const standPat=col==='w'?evaluate(bd):-evaluate(bd);
  if(depth<=0)return standPat;
  if(standPat>=beta)return beta;
  if(standPat>alpha)alpha=standPat;

  const opp=col==='w'?'b':'w';
  const allMoves=genMoves(bd,col,null,'-');
  // Only captures
  const caps=allMoves.filter(m=>bd[m.t]||m.ep||m.pr);
  const ordered=orderMoves(bd,caps);

  for(const m of ordered){
    const nb=doMv(bd,m);
    if(inChk(nb,col))continue;
    const score=-quiesce(nb,-beta,-alpha,opp,depth-1);
    if(score>=beta)return beta;
    if(score>alpha)alpha=score;
  }
  return alpha;
}

// Main alpha-beta search
function abSearch(bd,depth,alpha,beta,col,ep,cas,allowNull){
  nodeCount++;
  if(depth<=0) return quiesce(bd,alpha,beta,col,6);

  const opp=col==='w'?'b':'w';
  const isInCheck=inChk(bd,col);

  // Check extension
  const ext=isInCheck?1:0;
  const effDepth=depth+ext;

  const ms=legal(bd,col,ep,cas);
  if(!ms.length) return isInCheck?(-99999+100*(10-depth)):0; // mate or stalemate

  const ordered=orderMoves(bd,ms);
  let bestScore=-Infinity;

  for(let i=0;i<ordered.length;i++){
    const m=ordered[i];
    const nb=doMv(bd,m);
    const nc=updCas(cas,m,bd);
    const ne=nextEp(m);

    let score;
    // Late move reduction for quiet moves
    if(i>=4 && effDepth>=3 && !bd[m.t] && !m.pr && !m.ep && !isInCheck){
      score=-abSearch(nb,effDepth-2,-beta,-alpha,opp,ne,nc,true);
      if(score<=alpha){continue}
    }
    score=-abSearch(nb,effDepth-1,-beta,-alpha,opp,ne,nc,true);

    if(score>bestScore)bestScore=score;
    if(score>alpha)alpha=score;
    if(alpha>=beta)break;
  }
  return bestScore;
}

// Iterative deepening with time limit
function findBestMove(bd,ep,cas,aiCol,maxDepth,timeLimitMs,randomness){
  const startTime=Date.now();
  const ms=legal(bd,aiCol,ep,cas);
  if(!ms.length)return null;
  if(ms.length===1)return{move:ms[0],eval:0,depth:1};

  let bestMove=ms[0], bestEval=0;
  const isAiWhite=aiCol==='w';
  const opp=aiCol==='w'?'b':'w';

  for(let d=1;d<=maxDepth;d++){
    if(Date.now()-startTime>timeLimitMs*0.8 && d>1)break;
    nodeCount=0;

    const ordered=d===1?orderMoves(bd,ms):[bestMove,...ms.filter(m=>m!==bestMove)];
    let dBest=-Infinity, dBestMove=ordered[0];
    let alpha=-Infinity, beta=Infinity;

    for(const m of ordered){
      const nb=doMv(bd,m);
      const nc=updCas(cas,m,bd);
      const ne=nextEp(m);
      const raw=-abSearch(nb,d-1,-beta,-alpha,opp,ne,nc,true);
      // Add randomness for lower difficulties
      const score=raw+(randomness>0?Math.floor((Math.random()-0.5)*randomness*2):0);

      if(score>dBest){dBest=score;dBestMove=m}
      if(raw>alpha)alpha=raw;
      if(Date.now()-startTime>timeLimitMs)break;
    }
    bestMove=dBestMove;
    bestEval=isAiWhite?dBest:-dBest; // normalize to white perspective
    if(Date.now()-startTime>timeLimitMs)break;
    // Found forced mate, stop searching
    if(Math.abs(dBest)>90000)break;
  }
  return{move:bestMove, eval:bestEval};
}

// ═══════════════════════════════════════════════════
// DIFFICULTY SETTINGS
// ═══════════════════════════════════════════════════
const DIFFS=[
  {name:'Beginner',   depth:1, time:200,  rand:200, elo:'~600',  color:'#5cb85c'},
  {name:'Novice',     depth:2, time:300,  rand:100, elo:'~800',  color:'#5cb85c'},
  {name:'Casual',     depth:2, time:500,  rand:50,  elo:'~1000', color:'#8cc152'},
  {name:'Club',       depth:3, time:800,  rand:20,  elo:'~1200', color:'#e8d5b5'},
  {name:'Intermediate',depth:3,time:1200, rand:10,  elo:'~1300', color:'#e8d5b5'},
  {name:'Strong',     depth:4, time:2000, rand:5,   elo:'~1500', color:'#e8a040'},
  {name:'Advanced',   depth:4, time:3000, rand:0,   elo:'~1600', color:'#e8a040'},
  {name:'Expert',     depth:5, time:4000, rand:0,   elo:'~1700', color:'#e06050'},
  {name:'Master',     depth:5, time:6000, rand:0,   elo:'~1800', color:'#d04040'},
  {name:'Maximum',    depth:6, time:10000,rand:0,   elo:'~1900+',color:'#b02020'},
];

const W_ORD=[WQ,WR,WB,WN,WP], B_ORD=[BQ,BR,BB,BN,BP];

// ═══════════════════════════════════════════════════
// STOCKFISH INTEGRATION HELPERS
// ═══════════════════════════════════════════════════
// Stockfish UCI Skill Level per difficulty index (0=weakest, 20=strongest)
const SF_SKILL=[0,2,4,6,8,11,13,15,17,20];

// Convert internal board array + game state to UCI FEN string
function boardToFEN(bd,col,ep,cas){
  const PC={[WP]:'P',[WN]:'N',[WB]:'B',[WR]:'R',[WQ]:'Q',[WK]:'K',
    [BP]:'p',[BN]:'n',[BB]:'b',[BR]:'r',[BQ]:'q',[BK]:'k'};
  const rows=[];
  for(let r=0;r<8;r++){let row='',emp=0;
    for(let c=0;c<8;c++){const p=bd[r*8+c];if(!p){emp++;}else{if(emp){row+=emp;emp=0;}row+=PC[p];}}
    if(emp)row+=emp;rows.push(row);}
  const epSq=ep!==null?(FL[toRC(ep)[1]]+RL[toRC(ep)[0]]):'-';
  return`${rows.join('/')} ${col} ${cas||'-'} ${epSq} 0 1`;
}

// Convert UCI move string (e.g. "e2e4","e1g1","e7e8q") to internal move object
function uciToMove(uci,bd,col,ep){
  const fc='abcdefgh'.indexOf(uci[0]),fr=8-parseInt(uci[1]);
  const tc='abcdefgh'.indexOf(uci[2]),tr=8-parseInt(uci[3]);
  const f=fr*8+fc,t=tr*8+tc,p=bd[f];
  const m={f,t};
  if(uci[4]){const pm={q:col==='w'?WQ:BQ,r:col==='w'?WR:BR,b:col==='w'?WB:BB,n:col==='w'?WN:BN};m.pr=pm[uci[4]];}
  if(ep===t&&(p===WP||p===BP))m.ep=1;
  if((p===WK||p===BK)&&Math.abs(tc-fc)===2)m.cas=tc>fc?'k':'q';
  if((p===WP||p===BP)&&Math.abs(tr-fr)===2)m.dbl=1;
  return m;
}

// ═══════════════════════════════════════════════════
// REVIEW / ANALYSIS HELPERS
// ═══════════════════════════════════════════════════
const GRADE_INFO={
  best:      {label:'최고',   sym:'⭐',color:'#3cdc82'},
  excellent: {label:'우수함', sym:'👍',color:'#89d4f0'},
  good:      {label:'좋음',   sym:'✓', color:'#6abf69'},
  inaccuracy:{label:'부정확', sym:'?!',color:'#f0c040'},
  mistake:   {label:'실수',   sym:'?', color:'#e8a040'},
  blunder:   {label:'블런더', sym:'??',color:'#e05050'},
};
function classifyMove(cpLoss){
  if(cpLoss<=0)return'best';if(cpLoss<=10)return'excellent';
  if(cpLoss<=25)return'good';if(cpLoss<=50)return'inaccuracy';
  if(cpLoss<=100)return'mistake';return'blunder';
}
function calcAccuracy(moves){
  if(!moves.length)return'–';
  const s=moves.reduce((a,m)=>a+Math.max(0,103.1668*Math.exp(-0.04354*Math.sqrt(Math.max(0,m.cpLoss)))-3.1668),0);
  return(Math.round(s/moves.length*10)/10).toFixed(1);
}

// ═══════════════════════════════════════════════════
// REACT COMPONENT
// ═══════════════════════════════════════════════════
export default function ChessEngine(){
  const[board,setBoard]=useState(initBoard);
  const[turn,setTurn]=useState('w');
  const[sel,setSel]=useState(null);
  const[lm,setLm]=useState([]);
  const[ep,setEp]=useState(null);
  const[cas,setCas]=useState('KQkq');
  const[over,setOver]=useState(null);
  const[di,setDi]=useState(3);
  const[thinking,setThinking]=useState(false);
  const[last,setLast]=useState(null);
  const[capW,setCapW]=useState([]);
  const[capB,setCapB]=useState([]);
  const[hist,setHist]=useState([]);
  const[promo,setPromo]=useState(null);
  const[pc,setPc]=useState('w');
  const[evalScore,setEvalScore]=useState(null);
  const[searchInfo,setSearchInfo]=useState('');
  const[histStates,setHistStates]=useState(()=>[{board:initBoard(),turn:'w',ep:null,cas:'KQkq',last:null,capW:[],capB:[]}]);
  const[viewIdx,setViewIdx]=useState(null);
  const[gameKey,setGameKey]=useState(0);
  const[hintMove,setHintMove]=useState(null);
  const[hintThinking,setHintThinking]=useState(false);
  const[analysisEvals,setAnalysisEvals]=useState([]);
  const[moveClassifications,setMoveClassifications]=useState([]);
  const[analyzing,setAnalyzing]=useState(false);
  const[analysisProgress,setAnalysisProgress]=useState({current:0,total:0});
  const[reviewMode,setReviewMode]=useState(false);

  const bR=useRef(board);bR.current=board;
  const tR=useRef(turn);tR.current=turn;
  const eR=useRef(ep);eR.current=ep;
  const cR=useRef(cas);cR.current=cas;
  const pR=useRef(pc);pR.current=pc;
  const dR=useRef(di);dR.current=di;
  const thR=useRef(thinking);thR.current=thinking;
  const oR=useRef(over);oR.current=over;
  const capWR=useRef(capW);capWR.current=capW;
  const capBR=useRef(capB);capBR.current=capB;
  const analysisAbortRef=useRef(false);

  // Stockfish worker refs (engine state, not React state)
  const sfWorkerRef=useRef(null);
  const sfReadyRef=useRef(false);
  const sfCallbackRef=useRef(null);
  const sfEvalRef=useRef(null);

  const ac=pc==='w'?'b':'w';
  const flip=pc==='b';

  // ── Stockfish worker lifecycle (mount / unmount) ──
  useEffect(()=>{
    try{
      const w=new Worker('/stockfish.js');
      sfWorkerRef.current=w;
      w.onmessage=(e)=>{
        const line=typeof e.data==='string'?e.data:String(e.data);
        if(line==='uciok'){w.postMessage('isready');}
        if(line==='readyok'){sfReadyRef.current=true;}
        if(line.startsWith('info')&&line.includes('score')){
          const cp=line.match(/score cp (-?\d+)/);
          const mt=line.match(/score mate (-?\d+)/);
          if(cp)sfEvalRef.current=parseInt(cp[1]);
          else if(mt)sfEvalRef.current=parseInt(mt[1])>0?99999:-99999;
        }
        if(line.startsWith('bestmove')&&sfCallbackRef.current){
          const bm=line.split(' ')[1];
          sfCallbackRef.current(bm,sfEvalRef.current);
          sfCallbackRef.current=null;
        }
      };
      w.postMessage('uci');
    }catch(err){console.warn('Stockfish worker init failed:',err);}
    return()=>{
      if(sfWorkerRef.current){sfWorkerRef.current.terminate();sfWorkerRef.current=null;sfReadyRef.current=false;}
    };
  },[]);

  const reset=useCallback((npc)=>{
    const p=npc!==undefined?npc:pR.current;
    const initB=initBoard();
    setBoard(initB);setTurn('w');setSel(null);setLm([]);setEp(null);setCas('KQkq');
    setOver(null);setThinking(false);setLast(null);setCapW([]);setCapB([]);setHist([]);
    setPromo(null);setPc(p);setEvalScore(null);setSearchInfo('');
    setHistStates([{board:initB,turn:'w',ep:null,cas:'KQkq',last:null,capW:[],capB:[]}]);
    setViewIdx(null);setHintMove(null);setHintThinking(false);
    analysisAbortRef.current=true;
    setAnalysisEvals([]);setMoveClassifications([]);setAnalyzing(false);
    setAnalysisProgress({current:0,total:0});setReviewMode(false);
    setGameKey(k=>k+1);
  },[]);

  const applyMv=useCallback((b,m,ep_,cas_,col)=>{
    const cap=b[m.t];const nb=doMv(b,m);const nc=updCas(cas_,m,b);const ne=nextEp(m);
    const nx=col==='w'?'b':'w';
    const newCapW=[...capWR.current,...(cap&&isW(cap)?[cap]:[]),...(m.ep&&col==='b'?[WP]:[])];
    const newCapB=[...capBR.current,...(cap&&isB(cap)?[cap]:[]),...(m.ep&&col==='w'?[BP]:[])];
    setBoard(nb);setCas(nc);setEp(ne);setLast({f:m.f,t:m.t});
    setCapW(newCapW);setCapB(newCapB);
    setHist(p=>[...p,`${SYM[b[m.f]]||''}${FL[m.f&7]}${RL[m.f>>3]}→${FL[m.t&7]}${RL[m.t>>3]}`]);
    setHistStates(p=>[...p,{board:nb,turn:nx,ep:ne,cas:nc,last:{f:m.f,t:m.t},capW:newCapW,capB:newCapB}]);
    setViewIdx(null);setHintMove(null);
    setTurn(nx);
    if(!legal(nb,nx,ne,nc).length){if(inChk(nb,nx))setOver(col==='w'?'White wins!':'Black wins!');else setOver('Stalemate')}
  },[]);

  // AI turn – Stockfish preferred; built-in alpha-beta as fallback
  useEffect(()=>{
    const aiC=pR.current==='w'?'b':'w';
    if(turn!==aiC||oR.current||thR.current)return;
    setThinking(true);
    const b=bR.current,e=eR.current,c=cR.current;
    const d=DIFFS[dR.current];

    if(sfReadyRef.current&&sfWorkerRef.current){
      let cancelled=false;
      sfEvalRef.current=null;
      sfCallbackRef.current=(uciMove,sfEval)=>{
        if(cancelled)return;
        if(uciMove&&uciMove!=='(none)'){
          const m=uciToMove(uciMove,b,aiC,e);
          setEvalScore(sfEval!==null?(aiC==='w'?sfEval:-sfEval):null);
          setSearchInfo(`Stockfish · skill ${SF_SKILL[dR.current]} · d${d.depth+4}`);
          applyMv(b,m,e,c,aiC);
        }
        setThinking(false);
      };
      const fen=boardToFEN(b,aiC,e,c);
      sfWorkerRef.current.postMessage(`setoption name Skill Level value ${SF_SKILL[dR.current]}`);
      sfWorkerRef.current.postMessage(`position fen ${fen}`);
      sfWorkerRef.current.postMessage(`go depth ${d.depth+4} movetime ${d.time}`);
      return()=>{
        cancelled=true;
        sfCallbackRef.current=null;
        if(sfWorkerRef.current)sfWorkerRef.current.postMessage('stop');
      };
    }

    const tid=setTimeout(()=>{
      const result=findBestMove(b,e,c,aiC,d.depth,d.time,d.rand);
      if(result&&result.move){
        setEvalScore(result.eval);
        setSearchInfo(`depth ${Math.min(result.depth||d.depth,d.depth)} · ${(nodeCount/1000).toFixed(0)}k nodes`);
        applyMv(b,result.move,e,c,aiC);
      }
      setThinking(false);
    },50);
    return()=>clearTimeout(tid);
  },[turn,applyMv,gameKey]);

  const click=useCallback((idx)=>{
    if(viewIdx!==null||turn!==pR.current||over||thinking)return;
    const myP=pR.current==='w'?isW:isB;
    const myPawn=pR.current==='w'?WP:BP;
    const pRow=pR.current==='w'?0:7;
    if(sel!==null){
      const m=lm.find(m=>m.t===idx);
      if(m){if(board[sel]===myPawn&&toRC(idx)[0]===pRow){setPromo({f:sel,t:idx,mvs:lm.filter(m=>m.t===idx)});return}
        applyMv(board,m,ep,cas,pR.current);setSel(null);setLm([]);return}
      if(myP(board[idx])){setSel(idx);setLm(legal(board,pR.current,ep,cas).filter(m=>m.f===idx));return}
      setSel(null);setLm([]);return}
    if(myP(board[idx])){setSel(idx);setLm(legal(board,pR.current,ep,cas).filter(m=>m.f===idx))}
  },[sel,lm,board,turn,over,thinking,ep,cas,applyMv,viewIdx]);

  const doPromo=useCallback(m=>{applyMv(board,m,ep,cas,pc);setSel(null);setLm([]);setPromo(null)},[board,ep,cas,pc,applyMv]);
  const swap=useCallback(()=>setPc(p=>p==='w'?'b':'w'),[]);

  const handleHint=useCallback(()=>{
    if(hintMove){setHintMove(null);return;}
    if(hintThinking||thinking||over||viewIdx!==null)return;
    setHintThinking(true);
    const b=board,e=ep,c=cas,t=turn;
    if(sfReadyRef.current&&sfWorkerRef.current){
      sfCallbackRef.current=(uciMove)=>{
        if(uciMove&&uciMove!=='(none)'){
          const fc='abcdefgh'.indexOf(uciMove[0]),fr=8-parseInt(uciMove[1]);
          const tc='abcdefgh'.indexOf(uciMove[2]),tr=8-parseInt(uciMove[3]);
          setHintMove({f:fr*8+fc,t:tr*8+tc});
        }
        setHintThinking(false);
      };
      sfWorkerRef.current.postMessage('setoption name Skill Level value 20');
      sfWorkerRef.current.postMessage(`position fen ${boardToFEN(b,t,e,c)}`);
      sfWorkerRef.current.postMessage(`go depth 18 movetime 2000`);
    }else{
      const result=findBestMove(b,e,c,t,3,600,0);
      if(result&&result.move)setHintMove({f:result.move.f,t:result.move.t});
      setHintThinking(false);
    }
  },[hintMove,hintThinking,thinking,over,viewIdx,board,ep,cas,turn]);

  const handleUndo=useCallback(()=>{
    if(thinking||histStates.length<3||viewIdx!==null)return;
    const targetIdx=histStates.length-3;
    const s=histStates[targetIdx];
    setBoard(s.board);setTurn(s.turn);setEp(s.ep);setCas(s.cas);
    setCapW(s.capW);setCapB(s.capB);setLast(s.last);
    setHistStates(prev=>prev.slice(0,targetIdx+1));
    setHist(prev=>prev.slice(0,prev.length-2));
    setSel(null);setLm([]);setOver(null);setThinking(false);
    setPromo(null);setHintMove(null);setEvalScore(null);setSearchInfo('');
    setViewIdx(null);
  },[thinking,histStates,viewIdx]);

  const runAnalysis=useCallback(()=>{
    if(analyzing||histStates.length<2)return;
    analysisAbortRef.current=false;
    setAnalyzing(true);setReviewMode(false);
    const total=histStates.length;
    setAnalysisProgress({current:0,total});
    const evals=new Array(total).fill(null);
    let idx=0;
    // Clean Stockfish state before starting
    if(sfReadyRef.current&&sfWorkerRef.current){
      sfWorkerRef.current.postMessage('stop');
      sfWorkerRef.current.postMessage('ucinewgame');
    }
    const next=()=>{
      if(analysisAbortRef.current){setAnalyzing(false);return;}
      if(idx>=total){
        const cls=[];
        for(let i=0;i<total-1;i++){
          const t=histStates[i].turn;
          const ei=evals[i]??0,ei1=evals[i+1]??0;
          const cpLoss=t==='w'?Math.max(0,ei-ei1):Math.max(0,ei1-ei);
          cls.push({cpLoss,player:t,grade:classifyMove(cpLoss)});
        }
        setAnalysisEvals([...evals]);setMoveClassifications(cls);
        setAnalyzing(false);setReviewMode(true);
        return;
      }
      const s=histStates[idx];
      setAnalysisProgress({current:idx+1,total});
      if(sfReadyRef.current&&sfWorkerRef.current){
        sfEvalRef.current=null;
        let watchdog=null;
        const doNext=(uciMove,sfEval)=>{
          if(watchdog){clearTimeout(watchdog);watchdog=null;}
          if(analysisAbortRef.current){setAnalyzing(false);return;}
          evals[idx]=sfEval!=null?(s.turn==='w'?sfEval:-sfEval):0;
          idx++;
          setTimeout(next,30); // let event loop breathe between positions
        };
        sfCallbackRef.current=doNext;
        // Watchdog: if Stockfish doesn't respond in 8s (e.g. background tab), skip position
        watchdog=setTimeout(()=>{
          if(sfCallbackRef.current===doNext){
            sfCallbackRef.current=null;
            doNext(null,sfEvalRef.current);
          }
        },8000);
        sfWorkerRef.current.postMessage('setoption name Skill Level value 20');
        sfWorkerRef.current.postMessage(`position fen ${boardToFEN(s.board,s.turn,s.ep,s.cas)}`);
        sfWorkerRef.current.postMessage('go depth 12'); // depth-only: predictable finish time
      }else{
        const r=findBestMove(s.board,s.ep,s.cas,s.turn,4,800,0);
        evals[idx]=r?(s.turn==='w'?r.eval:-r.eval):0;
        idx++;
        setTimeout(next,0);
      }
    };
    next();
  },[analyzing,histStates]);

  const renderEvalGraph=()=>{
    if(analysisEvals.length<2)return null;
    const W=400,H=72,MAXE=600,n=analysisEvals.length;
    const xS=i=>Math.round((i/(n-1))*W);
    const yS=e=>{const c=Math.max(-MAXE,Math.min(MAXE,e??0));return Math.round(H/2-(c/MAXE)*(H/2-4));};
    const pts=analysisEvals.map((e,i)=>[xS(i),yS(e)]);
    const line=pts.map(([x,y],i)=>`${i===0?'M':'L'}${x} ${y}`).join(' ');
    const area=`${line} L${xS(n-1)} ${H/2} L${xS(0)} ${H/2}Z`;
    const GCOL={best:'#3cdc82',excellent:'#89d4f0',good:'#6abf69',inaccuracy:'#f0c040',mistake:'#e8a040',blunder:'#e05050'};
    return(
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:'block',borderRadius:4}} preserveAspectRatio="none">
        <defs>
          <clipPath id="clip-top"><rect x={0} y={0} width={W} height={H/2}/></clipPath>
          <clipPath id="clip-bot"><rect x={0} y={H/2} width={W} height={H/2}/></clipPath>
        </defs>
        <rect width={W} height={H} fill="#16213e"/>
        <path d={area} fill="rgba(232,224,208,0.45)" clipPath="url(#clip-top)"/>
        <path d={area} fill="rgba(15,15,35,0.65)" clipPath="url(#clip-bot)"/>
        <line x1={0} y1={H/2} x2={W} y2={H/2} stroke="rgba(255,255,255,0.18)" strokeWidth={0.5}/>
        <path d={line} fill="none" stroke="rgba(200,180,140,0.7)" strokeWidth={1}/>
        {moveClassifications.map((mc,i)=>{
          const x=xS(i+1),y=yS(analysisEvals[i+1]);
          return<circle key={i} cx={x} cy={y} r={3} fill={GCOL[mc.grade]||'#888'} style={{cursor:'pointer'}} onClick={()=>setViewIdx(i+1)}/>;
        })}
        {effectiveIdx>=0&&effectiveIdx<n&&(
          <line x1={xS(effectiveIdx)} y1={0} x2={xS(effectiveIdx)} y2={H} stroke="rgba(255,200,0,0.6)" strokeWidth={1} strokeDasharray="2,2"/>
        )}
      </svg>
    );
  };

  const chk=!over&&inChk(board,turn);

  // Eval bar – 500cp(5점) = 거의 꽉 참
  const evalPct=(()=>{
    if(evalScore===null)return 50;
    if(evalScore>=9999)return 96;if(evalScore<=-9999)return 4;
    return Math.max(4,Math.min(96, 50+(evalScore/500)*46));
  })();
  const evalText=evalScore===null?'0.0':Math.abs(evalScore)>=9999?(evalScore>0?'M+':'M-'):`${evalScore>0?'+':''}${(evalScore/100).toFixed(1)}`;

  // Navigation
  const effectiveIdx=viewIdx!==null?viewIdx:histStates.length-1;
  const canBack=effectiveIdx>0;
  const canFwd=effectiveIdx<histStates.length-1;
  const isLive=viewIdx===null;
  const goBack=()=>setViewIdx(effectiveIdx-1);
  const goFwd=()=>{const next=effectiveIdx+1;if(next>=histStates.length-1)setViewIdx(null);else setViewIdx(next);};
  const activeHistIdx=effectiveIdx-1;

  // Display state (historical view or live)
  const viewState=viewIdx!==null?histStates[viewIdx]:null;
  const displayBoard=viewState?viewState.board:board;
  const displayLast=viewState?viewState.last:last;
  const displayCapW=viewState?viewState.capW:capW;
  const displayCapB=viewState?viewState.capB:capB;
  const displayMatAdv=(()=>{let wL=0,bL=0;displayCapW.forEach(p=>wL+=mv(p));displayCapB.forEach(p=>bL+=mv(p));return bL-wL})();

  const renderCap=(pieces,order,adv)=>{
    const g={};order.forEach(p=>g[p]=0);pieces.forEach(p=>g[p]=(g[p]||0)+1);
    return(<div style={{display:'flex',alignItems:'center',gap:1,minHeight:26,flexWrap:'wrap'}}>
      {order.map(p=>{if(!g[p])return null;return Array.from({length:g[p]}).map((_,i)=>(
        <span key={`${p}-${i}`} style={{fontSize:17,lineHeight:1,marginRight:i===g[p]-1?3:-3,
          color:isW(p)?'#f5f0e8':'#555',WebkitTextStroke:isW(p)?'0.5px #4a3520':'none',
          filter:isW(p)?'drop-shadow(0 1px 1px rgba(0,0,0,0.6))':'none'}}>{SYM[p]}</span>))})}
      {adv>0&&<span style={{fontSize:12,fontWeight:700,color:'#7ecf7e',fontFamily:"'Space Mono',monospace",marginLeft:4}}>+{adv}</span>}
    </div>);
  };

  const renderBoard=()=>{
    const sq=[];
    for(let ri=0;ri<8;ri++)for(let ci=0;ci<8;ci++){
      const r=flip?7-ri:ri,c=flip?7-ci:ci,idx=rc(r,c);
      const piece=displayBoard[idx];const lt=(r+c)%2===0;
      const isSel=isLive&&sel===idx,isLeg=isLive&&lm.some(m=>m.t===idx);
      const isLst=displayLast&&(displayLast.f===idx||displayLast.t===idx);
      const isKC=isLive&&chk&&((turn==='w'&&piece===WK)||(turn==='b'&&piece===BK));
      let bg=lt?'#e8d5b5':'#b58863';
      if(isLst)bg=lt?'#f6f680':'#baca44';if(isSel)bg='#7fc97f';if(isKC)bg='#e74c3c';
      sq.push(<div key={idx} onClick={()=>click(idx)}
        style={{width:'12.5%',height:'12.5%',backgroundColor:bg,display:'flex',alignItems:'center',justifyContent:'center',position:'relative',cursor:isLive&&turn===pc&&!over?'pointer':'default',transition:'background-color 0.15s',userSelect:'none'}}>
        {isLeg&&!piece&&<div style={{width:'26%',height:'26%',borderRadius:'50%',backgroundColor:'rgba(0,0,0,0.18)'}}/>}
        {isLeg&&!!piece&&<div style={{position:'absolute',inset:0,border:'4px solid rgba(0,0,0,0.25)',borderRadius:'50%',boxSizing:'border-box'}}/>}
        {!!piece&&<span style={{fontSize:'min(6vw, 44px)',lineHeight:1,zIndex:1,
          color:isW(piece)?'#f5f0e8':'#1a1a1a',
          WebkitTextStroke:isW(piece)?'0.8px #4a3520':'0.5px #000',
          filter:isW(piece)?'drop-shadow(1px 1px 2px rgba(0,0,0,0.5))':'drop-shadow(1px 1px 1px rgba(0,0,0,0.3))'
        }}>{SYM[piece]}</span>}
        {ci===0&&<span style={{position:'absolute',top:2,left:3,fontSize:'10px',fontWeight:700,color:lt?'#b58863':'#e8d5b5',opacity:0.8}}>{RL[flip?7-ri:ri]}</span>}
        {ri===7&&<span style={{position:'absolute',bottom:1,right:3,fontSize:'10px',fontWeight:700,color:lt?'#b58863':'#e8d5b5',opacity:0.8}}>{FL[flip?7-ci:ci]}</span>}
      </div>);}
    return sq;
  };

  const topCapDisp=pc==='w'?displayCapB:displayCapW, botCapDisp=pc==='w'?displayCapW:displayCapB;
  const topOrd=pc==='w'?B_ORD:W_ORD, botOrd=pc==='w'?W_ORD:B_ORD;
  const topAdv=pc==='w'?(displayMatAdv>0?displayMatAdv:0):(displayMatAdv<0?-displayMatAdv:0);
  const botAdv=pc==='w'?(displayMatAdv<0?-displayMatAdv:0):(displayMatAdv>0?displayMatAdv:0);
  const d=DIFFS[di];

  return(
    <div style={{minHeight:'100vh',background:'linear-gradient(145deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:16,fontFamily:"'DM Sans',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Mono:wght@700&display=swap" rel="stylesheet"/>

      {/* Title */}
      <div style={{fontSize:'clamp(16px,3.5vw,24px)',fontFamily:"'Space Mono',monospace",fontWeight:700,color:'#e8d5b5',marginBottom:6,letterSpacing:2,textTransform:'uppercase'}}>
        ♚ Chess Arena <span style={{fontSize:10,color:'#e8a040',letterSpacing:0,textTransform:'none',fontFamily:"'DM Sans',sans-serif",fontWeight:400}}>Enhanced Engine</span>
      </div>

      {/* Controls */}
      <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap',justifyContent:'center'}}>
        <button onClick={swap}
          style={{padding:'5px 12px',background:'rgba(255,255,255,0.08)',color:'#ccc',border:'1px solid rgba(255,255,255,0.12)',borderRadius:6,fontWeight:700,fontSize:12,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>
          {pc==='w'?'♔ White':'♚ Black'} ⇄
        </button>
        <button onClick={()=>reset()}
          style={{padding:'5px 12px',background:'rgba(255,255,255,0.08)',color:'#ccc',border:'1px solid rgba(255,255,255,0.12)',borderRadius:6,fontWeight:700,fontSize:12,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>
          New Game
        </button>
      </div>

      {/* Difficulty slider */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,width:'min(84vw,400px)'}}>
        <span style={{fontSize:11,color:'#777',whiteSpace:'nowrap'}}>난이도</span>
        <div style={{flex:1}}>
          <input type="range" min={0} max={9} value={di} onChange={e=>setDi(+e.target.value)}
            style={{width:'100%',appearance:'none',height:6,background:'linear-gradient(to right,#5cb85c,#e8a040,#d04040)',borderRadius:3,outline:'none',cursor:'pointer'}}/>
        </div>
        <div style={{minWidth:90,textAlign:'right'}}>
          <div style={{fontSize:12,fontWeight:700,color:d.color,fontFamily:"'Space Mono',monospace"}}>{d.name}</div>
          <div style={{fontSize:9,color:'#666'}}>{d.elo} · depth {d.depth}</div>
        </div>
      </div>

      {/* Opponent */}
      <div style={{width:'min(88vw,420px)',marginBottom:3,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          <div style={{width:24,height:24,borderRadius:5,background:ac==='w'?'#ddd':'#333',border:`2px solid ${ac==='w'?'#aaa':'#555'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13}}>{ac==='w'?'♔':'♚'}</div>
          <span style={{fontSize:11,fontWeight:700,color:'#888'}}>AI</span>
        </div>
        {renderCap(topCapDisp,topOrd,topAdv)}
      </div>

      {/* Board + Eval bar */}
      <div style={{display:'flex',gap:0,alignItems:'stretch'}}>
        {/* Eval bar – 내 색상이 아래부터 차오름 */}
        <div style={{width:14,borderRadius:'3px 0 0 3px',overflow:'hidden',background:flip?'#e8e0d0':'#2a2a2a',position:'relative',flexShrink:0}}>
          <div style={{position:'absolute',bottom:0,left:0,right:0,height:`${flip?100-evalPct:evalPct}%`,background:flip?'#2a2a2a':'#e8e0d0',transition:'height 0.5s ease'}}/>
          <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%) rotate(-90deg)',fontSize:8,fontWeight:700,color:'#888',whiteSpace:'nowrap',fontFamily:"'Space Mono',monospace"}}>
            {evalText}
          </div>
        </div>

        {/* Board */}
        <div style={{width:'min(84vw,400px)',height:'min(84vw,400px)',display:'flex',flexWrap:'wrap',borderRadius:'0 4px 4px 0',overflow:'hidden',boxShadow:'0 8px 40px rgba(0,0,0,0.5)',position:'relative'}}>
          {renderBoard()}

          {hintMove&&(()=>{
            const sc=(idx)=>{const r=idx>>3,c=idx&7;return[(flip?7-c:c)*12.5+6.25,(flip?7-r:r)*12.5+6.25];};
            const[x1,y1]=sc(hintMove.f);const[x2,y2]=sc(hintMove.t);
            const dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy);
            const ex=x2-dx/len*4,ey=y2-dy/len*4;
            return(<svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:6}} viewBox="0 0 100 100">
              <defs><marker id="ha" markerWidth="3" markerHeight="3" refX="1.5" refY="1.5" orient="auto">
                <polygon points="0 0,3 1.5,0 3" fill="rgba(60,220,130,0.88)"/></marker></defs>
              <circle cx={x1} cy={y1} r="4" fill="rgba(60,220,130,0.2)" stroke="rgba(60,220,130,0.7)" strokeWidth="0.8"/>
              <line x1={x1} y1={y1} x2={ex} y2={ey} stroke="rgba(60,220,130,0.82)" strokeWidth="1.8" markerEnd="url(#ha)" strokeLinecap="round"/>
            </svg>);
          })()}

          {promo&&(
            <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:10}}>
              <div style={{background:'#2a2a4a',borderRadius:12,padding:'18px 14px',display:'flex',gap:10,boxShadow:'0 4px 20px rgba(0,0,0,0.5)'}}>
                {promo.mvs.map((m,i)=>(
                  <button key={i} onClick={()=>doPromo(m)}
                    style={{width:52,height:52,fontSize:34,background:'rgba(255,255,255,0.1)',border:'2px solid rgba(255,255,255,0.2)',borderRadius:8,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff'}}
                  >{SYM[m.pr]}</button>))}
              </div>
            </div>)}
        </div>
      </div>

      {/* Player */}
      <div style={{width:'min(88vw,420px)',marginTop:3,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          <div style={{width:24,height:24,borderRadius:5,background:pc==='w'?'#ddd':'#333',border:`2px solid ${pc==='w'?'#aaa':'#555'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13}}>{pc==='w'?'♔':'♚'}</div>
          <span style={{fontSize:11,fontWeight:700,color:'#ccc'}}>You</span>
        </div>
        {renderCap(botCapDisp,botOrd,botAdv)}
      </div>

      {/* Status */}
      <div style={{marginTop:8,fontSize:13,fontWeight:500,display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',justifyContent:'center'}}>
          {over?(
            <div style={{display:'flex',alignItems:'center',gap:10,background:'rgba(232,213,181,0.08)',border:'1px solid rgba(232,213,181,0.2)',borderRadius:8,padding:'6px 14px'}}>
              <span style={{color:'#e8d5b5',fontWeight:700,fontFamily:"'Space Mono',monospace",fontSize:14}}>{over}</span>
              <button onClick={()=>reset()} style={{padding:'4px 12px',background:'#e8d5b5',color:'#1a1a2e',border:'none',borderRadius:6,fontWeight:700,fontSize:12,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>Play Again</button>
            </div>
          ):thinking?(
            <><span style={{display:'inline-block',width:10,height:10,borderRadius:'50%',border:'2px solid #f0c040',borderTopColor:'transparent',animation:'spin 0.8s linear infinite'}}/><span style={{color:'#f0c040'}}>AI thinking...</span></>
          ):chk?(
            <span style={{color:'#e74c3c'}}>Check!</span>
          ):(
            <span style={{color:'#888'}}>{turn==='w'?'White':'Black'} to move</span>
          )}
        </div>
        {over&&!analyzing&&!reviewMode&&hist.length>1&&(
          <button onClick={runAnalysis}
            style={{padding:'6px 20px',background:'linear-gradient(135deg,#2a6e4a,#1a4a30)',color:'#7ef0b0',border:'1px solid rgba(60,220,130,0.3)',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",letterSpacing:0.5}}>
            📊 리뷰 시작
          </button>
        )}
        {analyzing&&(
          <div style={{width:'min(84vw,400px)',textAlign:'center'}}>
            <div style={{fontSize:11,color:'#e8a040',marginBottom:4,fontFamily:"'Space Mono',monospace"}}>
              분석 중... {analysisProgress.current}/{analysisProgress.total}
            </div>
            <div style={{height:4,background:'rgba(255,255,255,0.08)',borderRadius:2}}>
              <div style={{height:'100%',background:'#e8a040',borderRadius:2,transition:'width 0.3s',width:`${analysisProgress.total?Math.round(analysisProgress.current/analysisProgress.total*100):0}%`}}/>
            </div>
          </div>
        )}
      </div>
      {searchInfo&&<div style={{fontSize:9,color:'#555',marginTop:2,fontFamily:"'Space Mono',monospace"}}>{searchInfo}</div>}

      {/* Move history + navigation */}
      {hist.length>0&&(
        <div style={{marginTop:8,width:'min(88vw,420px)'}}>
          <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:4,flexWrap:'wrap'}}>
            <button onClick={()=>setViewIdx(0)} disabled={!canBack}
              style={{padding:'2px 7px',background:'rgba(255,255,255,0.06)',color:canBack?'#ccc':'#3a3a4a',border:'1px solid rgba(255,255,255,0.08)',borderRadius:4,fontSize:13,cursor:canBack?'pointer':'default',fontFamily:"'Space Mono',monospace",lineHeight:1.4}}>⏮</button>
            <button onClick={goBack} disabled={!canBack}
              style={{padding:'2px 9px',background:'rgba(255,255,255,0.06)',color:canBack?'#ccc':'#3a3a4a',border:'1px solid rgba(255,255,255,0.08)',borderRadius:4,fontSize:15,cursor:canBack?'pointer':'default',fontFamily:"'Space Mono',monospace",lineHeight:1.3}}>‹</button>
            <button onClick={goFwd} disabled={!canFwd}
              style={{padding:'2px 9px',background:'rgba(255,255,255,0.06)',color:canFwd?'#ccc':'#3a3a4a',border:'1px solid rgba(255,255,255,0.08)',borderRadius:4,fontSize:15,cursor:canFwd?'pointer':'default',fontFamily:"'Space Mono',monospace",lineHeight:1.3}}>›</button>
            <button onClick={()=>setViewIdx(null)} disabled={isLive}
              style={{padding:'2px 7px',background:'rgba(255,255,255,0.06)',color:!isLive?'#ccc':'#3a3a4a',border:'1px solid rgba(255,255,255,0.08)',borderRadius:4,fontSize:13,cursor:!isLive?'pointer':'default',fontFamily:"'Space Mono',monospace",lineHeight:1.4}}>⏭</button>
            <div style={{width:1,height:14,background:'rgba(255,255,255,0.1)',margin:'0 2px'}}/>
            {(()=>{const canUndo=!thinking&&histStates.length>=3&&isLive;return(
              <button onClick={handleUndo} disabled={!canUndo} title="한수 무르기"
                style={{padding:'2px 8px',background:'rgba(255,255,255,0.06)',color:canUndo?'#ccc':'#3a3a4a',border:'1px solid rgba(255,255,255,0.08)',borderRadius:4,fontSize:11,cursor:canUndo?'pointer':'default',fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>↩ 무르기</button>
            );})()}
            {(()=>{const canHint=!thinking&&!over&&isLive;const active=!!hintMove;return(
              <button onClick={handleHint} disabled={!canHint&&!active} title="최적 수 힌트"
                style={{padding:'2px 8px',background:active?'rgba(60,220,130,0.15)':'rgba(255,255,255,0.06)',color:!canHint&&!active?'#3a3a4a':active?'#3cdc82':'#ccc',border:`1px solid ${active?'rgba(60,220,130,0.4)':'rgba(255,255,255,0.08)'}`,borderRadius:4,fontSize:11,cursor:(canHint||active)?'pointer':'default',fontFamily:"'DM Sans',sans-serif",fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
                {hintThinking?<span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',border:'1.5px solid #3cdc82',borderTopColor:'transparent',animation:'spin 0.8s linear infinite'}}/>:'💡'}
                {active?'힌트 끄기':'힌트'}
              </button>
            );})()}
            {!isLive&&<span style={{fontSize:10,color:'#f0c040',fontFamily:"'Space Mono',monospace",marginLeft:2}}>복기 중</span>}
          </div>
          <div style={{maxHeight:64,overflowY:'auto',background:'rgba(255,255,255,0.04)',borderRadius:6,padding:'6px 10px',display:'flex',flexWrap:'wrap',gap:'3px 8px',fontSize:11,fontFamily:"'Space Mono',monospace"}}>
            {hist.map((m,i)=>{
              const mc=moveClassifications[i];const gi=mc?GRADE_INFO[mc.grade]:null;
              return(
                <span key={i} onClick={()=>setViewIdx(i+1)}
                  style={{color:i===activeHistIdx?'#f0c040':i%2===0?'#e8d5b5':'#8aa8d5',cursor:'pointer',fontWeight:i===activeHistIdx?700:400,textDecoration:i===activeHistIdx?'underline':'none',display:'inline-flex',alignItems:'center',gap:2}}>
                  {i%2===0?`${Math.floor(i/2)+1}. `:''}{m}{gi&&<span title={gi.label} style={{fontSize:9,color:gi.color,lineHeight:1}}>{gi.sym}</span>}
                </span>
              );
            })}
          </div>
        </div>)}

      {/* Review panel */}
      {reviewMode&&(
        <div style={{marginTop:12,width:'min(88vw,420px)',background:'rgba(255,255,255,0.04)',borderRadius:10,padding:'14px 16px',border:'1px solid rgba(255,255,255,0.08)'}}>
          <div style={{fontSize:13,fontWeight:700,color:'#e8d5b5',marginBottom:10,fontFamily:"'Space Mono',monospace",letterSpacing:1}}>📊 수 분석</div>
          {/* Eval graph */}
          <div style={{marginBottom:12,borderRadius:6,overflow:'hidden'}}>
            {renderEvalGraph()}
          </div>
          {/* Accuracy scores */}
          <div style={{display:'flex',gap:10,marginBottom:12}}>
            {[['w',pc==='w'?'You':'AI'],['b',pc==='b'?'You':'AI']].map(([color,label])=>{
              const moves=moveClassifications.filter(m=>m.player===color);
              const acc=calcAccuracy(moves);
              return(
                <div key={color} style={{flex:1,background:'rgba(255,255,255,0.04)',borderRadius:8,padding:'10px 12px',textAlign:'center',border:'1px solid rgba(255,255,255,0.06)'}}>
                  <div style={{fontSize:9,color:'#777',marginBottom:3,textTransform:'uppercase',letterSpacing:0.5}}>{label} ({color==='w'?'백':'흑'})</div>
                  <div style={{fontSize:26,fontWeight:700,color:'#e8d5b5',fontFamily:"'Space Mono',monospace",lineHeight:1}}>{acc}</div>
                  <div style={{fontSize:9,color:'#666',marginTop:2}}>정확도 %</div>
                </div>
              );
            })}
          </div>
          {/* Grade breakdown */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5}}>
            {Object.entries(GRADE_INFO).map(([key,gi])=>{
              const wC=moveClassifications.filter(m=>m.player==='w'&&m.grade===key).length;
              const bC=moveClassifications.filter(m=>m.player==='b'&&m.grade===key).length;
              if(!wC&&!bC)return null;
              return(
                <div key={key} style={{display:'flex',alignItems:'center',gap:6,background:'rgba(255,255,255,0.03)',borderRadius:6,padding:'5px 8px',border:`1px solid ${gi.color}33`}}>
                  <span style={{fontSize:13,width:20,textAlign:'center',flexShrink:0}}>{gi.sym}</span>
                  <div style={{flex:1,fontSize:10,color:gi.color,fontWeight:700}}>{gi.label}</div>
                  <div style={{display:'flex',gap:3,fontSize:11,fontFamily:"'Space Mono',monospace"}}>
                    <span title="백" style={{color:'#e8d5b5',background:'rgba(232,224,208,0.1)',borderRadius:3,padding:'1px 5px'}}>{wC}</span>
                    <span title="흑" style={{color:'#8aa8d5',background:'rgba(138,168,213,0.1)',borderRadius:3,padding:'1px 5px'}}>{bC}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:2px}
        input[type=range]::-webkit-slider-thumb{appearance:none;width:16px;height:16px;border-radius:50%;background:#e8d5b5;border:2px solid #1a1a2e;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.4)}
        input[type=range]::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#e8d5b5;border:2px solid #1a1a2e;cursor:pointer}
      `}</style>
    </div>
  );
}
