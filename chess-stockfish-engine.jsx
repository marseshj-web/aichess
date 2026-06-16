import { useState, useCallback, useEffect, useRef, useMemo } from "react";

// ═══════════════════════════════════════════════════
// TUNING CONSTANTS
// ═══════════════════════════════════════════════════
const UCI_ELO_MIN = 1320;        // Stockfish UCI_Elo minimum threshold
const OPENING_BOOK_PLY = 30;     // Max half-moves to consult opening book
const HINT_MOVETIME_MS = 3000;   // Stockfish search time for hints
const LIVE_EVAL_MOVETIME_MS = 600;// Background eval-bar refresh on the player's turn
const ANALYSIS_DEPTH = 12;       // Stockfish depth for post-game analysis
const ANALYSIS_TIMEOUT_MS = 8000;// Watchdog timeout per analysis position

// ═══════════════════════════════════════════════════
// PIECE CONSTANTS
// ═══════════════════════════════════════════════════
const E=0,WP=1,WN=2,WB=3,WR=4,WQ=5,WK=6,BP=7,BN=8,BB=9,BR=10,BQ=11,BK=12;
const SYM={[WP]:'♟',[WN]:'♞',[WB]:'♝',[WR]:'♜',[WQ]:'♛',[WK]:'♚',
  [BP]:'♟',[BN]:'♞',[BB]:'♝',[BR]:'♜',[BQ]:'♛',[BK]:'♚'};
const PIECE_SVG={[WP]:'/pieces/wP.svg',[WN]:'/pieces/wN.svg',[WB]:'/pieces/wB.svg',
  [WR]:'/pieces/wR.svg',[WQ]:'/pieces/wQ.svg',[WK]:'/pieces/wK.svg',
  [BP]:'/pieces/bP.svg',[BN]:'/pieces/bN.svg',[BB]:'/pieces/bB.svg',
  [BR]:'/pieces/bR.svg',[BQ]:'/pieces/bQ.svg',[BK]:'/pieces/bK.svg'};
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

// Standard Algebraic Notation for a played move.
// before/after: board arrays before & after the move. m:{f,t}. ep/cas: state BEFORE the move.
const SAN_L=['','N','B','R','Q','K']; // index = piece type (0=pawn)
function toSAN(before,after,m,ep,cas){
  const piece=before[m.f];if(!piece)return'';
  const col=isW(piece)?'w':'b';
  const ptype=(piece-1)%6; // 0=P 1=N 2=B 3=R 4=Q 5=K
  const[fr,fc]=toRC(m.f),[tr,tc]=toRC(m.t);
  let san;
  if(ptype===5&&Math.abs(tc-fc)===2){
    san=tc>fc?'O-O':'O-O-O';
  }else{
    const dest=FL[tc]+RL[tr];
    const isEp=ptype===0&&fc!==tc&&before[m.t]===E;
    const isCap=before[m.t]!==E||isEp;
    if(ptype===0){
      san=isCap?FL[fc]+'x'+dest:dest;
      const promo=after[m.t]!==E?(after[m.t]-1)%6:0;
      if(promo!==0)san+='='+SAN_L[promo];
    }else{
      // disambiguation against other legal same-type moves to the same square
      const others=legal(before,col,ep,cas).filter(x=>x.t===m.t&&before[x.f]===piece&&x.f!==m.f);
      let dis='';
      if(others.length){
        const sameFile=others.some(x=>(x.f&7)===fc);
        const sameRank=others.some(x=>(x.f>>3)===fr);
        dis=!sameFile?FL[fc]:!sameRank?RL[fr]:FL[fc]+RL[fr];
      }
      san=SAN_L[ptype]+dis+(isCap?'x':'')+dest;
    }
  }
  const opp=col==='w'?'b':'w';
  if(inChk(after,opp)){
    const epA=ptype===0&&Math.abs(tr-fr)===2?rc((fr+tr)/2,fc):null;
    san+=legal(after,opp,epA,cas).length?'+':'#';
  }
  return san;
}
// Resolve a SAN token back to a move object against the given position (used by PGN import).
function sanToMove(san,bd,col,ep,cas){
  const want=san.replace(/[+#!?]/g,'');
  for(const m of legal(bd,col,ep,cas)){
    if(toSAN(bd,doMv(bd,m),m,ep,cas).replace(/[+#!?]/g,'')===want)return m;
  }
  return null;
}
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
  {name:'~600',  elo:600,  skill:0,  depth:1, time:150,  rand:250, color:'#5cb85c'},
  {name:'~700',  elo:700,  skill:1,  depth:1, time:200,  rand:200, color:'#5cb85c'},
  {name:'~800',  elo:800,  skill:2,  depth:1, time:250,  rand:150, color:'#7cbb52'},
  {name:'~900',  elo:900,  skill:3,  depth:2, time:300,  rand:100, color:'#8cc152'},
  {name:'~1000', elo:1000, skill:4,  depth:2, time:400,  rand:70,  color:'#8cc152'},
  {name:'~1100', elo:1100, skill:5,  depth:2, time:550,  rand:50,  color:'#b8c152'},
  {name:'~1200', elo:1200, skill:6,  depth:3, time:700,  rand:30,  color:'#e8d5b5'},
  {name:'~1300', elo:1300, skill:7,  depth:3, time:900,  rand:20,  color:'#e8d5b5'},
  {name:'~1400', elo:1400, skill:8,  depth:3, time:1100, rand:10,  color:'#e8d5b5'},
  {name:'~1500', elo:1500, skill:10, depth:4, time:1400, rand:5,   color:'#e8b040'},
  {name:'~1600', elo:1600, skill:11, depth:4, time:1800, rand:3,   color:'#e8a040'},
  {name:'~1700', elo:1700, skill:12, depth:4, time:2500, rand:0,   color:'#e8a040'},
  {name:'~1800', elo:1800, skill:13, depth:4, time:3000, rand:0,   color:'#e07040'},
  {name:'~1900', elo:1900, skill:15, depth:5, time:4000, rand:0,   color:'#e06050'},
  {name:'~2000', elo:2000, skill:16, depth:5, time:5000, rand:0,   color:'#d05040'},
  {name:'~2100', elo:2100, skill:17, depth:5, time:6000, rand:0,   color:'#d04040'},
  {name:'~2200', elo:2200, skill:18, depth:6, time:7500, rand:0,   color:'#c03030'},
  {name:'~2300', elo:2300, skill:19, depth:6, time:9000, rand:0,   color:'#b02020'},
  {name:'Max',   elo:2400, skill:20, depth:6, time:10000,rand:0,   color:'#902010'},
];

// ═══════════════════════════════════════════════════
// AI OPPONENT ROSTER (chess.com-style characters)
// ═══════════════════════════════════════════════════
// style.aggression: -1(defensive) … 0(neutral) … +1(aggressive)
//   → among near-best moves, bias toward forcing (captures/checks/advances) or quiet moves
// style.blunderRate: 0…1, chance to pick the weakest of the MultiPV candidates (a mild inaccuracy)
// style.openings: UCI first-move(s) the bot signs its games with when playing White (else book/engine)
// elo flows into the existing DIFFS matcher + UCI_Elo/Skill Level pipeline unchanged → strength is reused.
const BOTS=[
  {id:'robin',  name:'삐약이 로빈',  avatar:'🐣', color:'#5cb85c', elo:700,
   title:'갓 입문한 병아리', bio:'기물을 자주 흘려요. 첫 게임 상대로 딱이에요.',
   style:{aggression:0,    blunderRate:0.28, openings:['e2e4']}},
  {id:'foxy',   name:'여우 폭시',    avatar:'🦊', color:'#e8a040', elo:1000,
   title:'함정의 달인',     bio:'덫을 좋아하고 가끔 무리하게 달려들어요.',
   style:{aggression:0.6,  blunderRate:0.18, openings:['e2e4']}},
  {id:'bruno',  name:'곰돌 브루노',  avatar:'🐻', color:'#b8c152', elo:1200,
   title:'느긋한 수비수',   bio:'서두르지 않고 단단하게 둬요.',
   style:{aggression:-0.6, blunderRate:0.12, openings:['d2d4']}},
  {id:'hopper', name:'토깽 호퍼',    avatar:'🐰', color:'#e8d5b5', elo:1400,
   title:'빠른 전개파',     bio:'기물을 재빨리 꺼내 공격을 노려요.',
   style:{aggression:0.4,  blunderRate:0.08, openings:['e2e4']}},
  {id:'hawk',   name:'매 호크',      avatar:'🦅', color:'#e8a040', elo:1600,
   title:'킹 사냥꾼',       bio:'상대 킹을 향해 거침없이 돌격합니다.',
   style:{aggression:0.9,  blunderRate:0.05, openings:['e2e4']}},
  {id:'shelly', name:'거북 셸리',    avatar:'🐢', color:'#5cb85c', elo:1600,
   title:'철벽 포지셔널',   bio:'같은 점수라도 스타일은 정반대! 안전 제일이에요.',
   style:{aggression:-0.8, blunderRate:0.04, openings:['c2c4']}},
  {id:'drake',  name:'용 드레이크',  avatar:'🐉', color:'#e07040', elo:1800,
   title:'희생의 화신',     bio:'기물을 던져서라도 공격을 이어갑니다.',
   style:{aggression:0.9,  blunderRate:0.03, openings:['e2e4']}},
  {id:'sage',   name:'부엉 세이지',  avatar:'🦉', color:'#89d4f0', elo:1950,
   title:'엔드게임 현자',   bio:'침착하고 포지셔널하게 운영해요.',
   style:{aggression:-0.4, blunderRate:0.02, openings:['d2d4']}},
  {id:'wally',  name:'월리 봇',      avatar:'🤖', color:'#d04040', elo:2100,
   title:'균형잡힌 머신',   bio:'뚜렷한 약점이 없는 만능형 상대.',
   style:{aggression:0,    blunderRate:0.01, openings:[]}},
  {id:'magna',  name:'챔피언 마그나', avatar:'👑', color:'#902010', elo:2400,
   title:'최강의 벽',       bio:'정확하고 무자비합니다. 행운을 빌어요.',
   style:{aggression:0,    blunderRate:0,    openings:[]}},
];
const CUSTOM_BOT={id:'custom',name:'커스텀 AI',avatar:'🎚️',color:'#9aa0a6',
  title:'직접 설정한 난이도', bio:'슬라이더로 ELO를 직접 정한 상대예요.',
  style:{aggression:0,blunderRate:0,openings:[]}}; // elo is taken from the slider value
const BOT_STORE_KEY='aichess_selected_bot_v1';
function botById(id){return BOTS.find(b=>b.id===id)||null;}
function loadInitialBot(){
  try{const b=botById(localStorage.getItem(BOT_STORE_KEY));if(b)return b;}catch(e){}
  return botById('bruno')||BOTS[0];
}

const W_ORD=[WQ,WR,WB,WN,WP], B_ORD=[BQ,BR,BB,BN,BP];

// ═══════════════════════════════════════════════════
// STOCKFISH INTEGRATION HELPERS
// ═══════════════════════════════════════════════════
// Parse a FEN string into the internal board representation
function fenToBoard(fen){
  const parts=fen.split(' ');
  const bd=new Array(64).fill(0);
  const pm={r:BR,n:BN,b:BB,q:BQ,k:BK,p:BP,R:WR,N:WN,B:WB,Q:WQ,K:WK,P:WP};
  let i=0;
  for(const ch of parts[0])if(ch==='/')continue;else if(ch>='1'&&ch<='8')i+=+ch;else bd[i++]=pm[ch];
  const turn=parts[1]==='w'?'w':'b';
  const cas=parts[2]==='-'?'':parts[2];
  let ep=null;
  if(parts[3]&&parts[3]!=='-'){ep=(8-+parts[3][1])*8+'abcdefgh'.indexOf(parts[3][0]);}
  return{board:bd,turn,cas,ep};
}

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
  let tc='abcdefgh'.indexOf(uci[2]),tr=8-parseInt(uci[3]);
  let f=fr*8+fc,t=tr*8+tc;
  const p=bd[f];
  
  // Castling normalization (in case engine sends e8a8 instead of e8c8)
  let cas=null;
  if((p===WK||p===BK)&&Math.abs(tc-fc)>=2){
    cas=tc>fc?'k':'q';
    tc=cas==='k'?6:2; // Force to g-file (6) or c-file (2)
    t=tr*8+tc;
  }

  const m={f,t};
  if(cas)m.cas=cas;
  if(uci[4]){const pm={q:col==='w'?WQ:BQ,r:col==='w'?WR:BR,b:col==='w'?WB:BB,n:col==='w'?WN:BN};m.pr=pm[uci[4]];}
  if(ep===t&&(p===WP||p===BP))m.ep=1;
  if((p===WP||p===BP)&&Math.abs(tr-fr)===2)m.dbl=1;
  return m;
}

// ── Personality move selection ──────────────────────────────────────────────
// How "forcing" a move is, for aggression bias: captures + checks + advancing toward the foe.
function moveForcefulness(bd,ep,uci,aiC){
  const m=uciToMove(uci,bd,aiC,ep);
  let s=0;
  if(bd[m.t]!==E||m.ep)s+=2;                       // capture
  if(inChk(doMv(bd,m),aiC==='w'?'b':'w'))s+=1;     // gives check
  const fr=m.f>>3,tr=m.t>>3;                        // row 0 = rank 8 (black side)
  const adv=aiC==='w'?(fr-tr):(tr-fr);             // >0 when moving toward the opponent
  if(adv>0)s+=adv*0.1;
  return s;
}
// Choose the bot's move among MultiPV candidates, honoring its personality.
// cands: [{move(uci),cp}] (cp = side-to-move perspective). bestUci: engine's reported bestmove.
// Strength is preserved: we never play a move evaluated higher than the engine intended; we only
// trade equal-ish moves for style, or (on a blunder roll) pick a slightly weaker one.
const PERSONALITY_TOL=40; // centipawns
function pickByPersonality(cands,style,bestUci,bd,ep,aiC){
  if(!cands||cands.length===0||!style)return bestUci;
  const anchor=cands.find(c=>c.move===bestUci);
  const anchorCp=anchor?anchor.cp:Math.max(...cands.map(c=>c.cp));
  if(style.blunderRate>0&&cands.length>1&&Math.random()<style.blunderRate){
    return cands.reduce((a,b)=>b.cp<a.cp?b:a).move; // weakest considered move (mild inaccuracy)
  }
  if(Math.abs(style.aggression)<0.05)return bestUci;
  // never stronger than the engine's intended move, and within TOL of it
  const near=cands.filter(c=>c.cp<=anchorCp+1&&c.cp>=anchorCp-PERSONALITY_TOL);
  if(near.length<=1)return bestUci;
  const scored=near.map(c=>({m:c.move,f:moveForcefulness(bd,ep,c.move,aiC)}));
  scored.sort((a,b)=>style.aggression>0?b.f-a.f:a.f-b.f);
  return scored[0].m;
}

// Parse principal variation (PV) from a Stockfish info line into full move objects array
function parsePV(pvLine,bd,col,ep){
  const m=pvLine.match(/\bpv\s+((?:[a-h][1-8][a-h][1-8][qrbn]?\s*)+)/);
  if(!m)return[];
  const tokens=m[1].trim().split(/\s+/).slice(0,8);
  const moves=[];let curBd=bd,curCol=col,curEp=ep;
  for(const uci of tokens){
    try{
      const mv=uciToMove(uci,curBd,curCol,curEp);
      moves.push(mv);
      curBd=doMv(curBd,mv);curEp=nextEp(mv);curCol=curCol==='w'?'b':'w';
    }catch(e){break;}
  }
  return moves;
}

// Lichess Opening Explorer: returns opening info and moves for a FEN position, or null on failure
async function getOpeningData(fen){
  try{
    const res=await fetch(`https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}&moves=5&topGames=0`,{signal:AbortSignal.timeout(2000)});
    if(!res.ok)return null;
    const data=await res.json();
    return data;
  }catch(e){}
  return null;
}

// Helper to keep old behavior for AI/analysis
async function getOpeningMove(fen){
  const data=await getOpeningData(fen);
  if(data&&data.moves&&data.moves.length>0)return data.moves.map(m=>m.uci);
  return null;
}

// ═══════════════════════════════════════════════════
// REVIEW / ANALYSIS HELPERS
// ═══════════════════════════════════════════════════
const GRADE_INFO={
  best:      {label:'최고',    sym:'⭐',color:'#3cdc82'},
  excellent: {label:'우수함',  sym:'👍',color:'#89d4f0'},
  good:      {label:'좋음',    sym:'✓', color:'#6abf69'},
  inaccuracy:{label:'부정확함',sym:'?!',color:'#f0c040'},
  mistake:   {label:'실수',    sym:'?', color:'#e8a040'},
  blunder:   {label:'블런더',  sym:'??',color:'#e05050'},
};
function classifyMove(cpLoss){
  if(cpLoss<=0)return'best';
  if(cpLoss<=20)return'excellent';   // 0.2점
  if(cpLoss<=50)return'good';        // 0.5점 이하: 좋은 수
  if(cpLoss<=100)return'inaccuracy'; // 1점
  if(cpLoss<=300)return'mistake';    // 3점 이하: 실수 (1.5점 포함)
  return'blunder';                   // 3점 초과: 블런더
}
function calcAccuracy(moves){
  if(!moves.length)return'–';
  const s=moves.reduce((a,m)=>a+Math.max(0,103.1668*Math.exp(-0.04354*Math.sqrt(Math.max(0,m.cpLoss)))-3.1668),0);
  return(Math.round(s/moves.length*10)/10).toFixed(1);
}

// ═══════════════════════════════════════════════════
// SOUNDS
// ═══════════════════════════════════════════════════
const SOUNDS = typeof Audio !== 'undefined' ? {
  move: new Audio('/sounds/move.mp3'),
  capture: new Audio('/sounds/capture.mp3'),
  check: new Audio('/sounds/check.mp3'),
  castle: new Audio('/sounds/castle.mp3'),
  gameEnd: new Audio('/sounds/gameEnd.mp3')
} : {};

const playSound = (type) => {
  if (SOUNDS[type]) {
    const s = SOUNDS[type].cloneNode();
    s.play().catch(e => console.log('Audio playback prevented:', e));
  }
};

// ═══════════════════════════════════════════════════
// PUZZLE UTILITIES — Lichess API integration
// ═══════════════════════════════════════════════════
const PUZZLE_CACHE_KEY = 'aichess_puzzle_cache_v1';

function lichessToInternal(d){
  return{id:d.puzzle.id,fen:d.puzzle.fen,moves:d.puzzle.solution,
    rating:d.puzzle.rating,themes:d.puzzle.themes};
}
function loadPuzzleCache(){
  try{return JSON.parse(localStorage.getItem(PUZZLE_CACHE_KEY)||'{}');}
  catch{return{};}
}
function savePuzzleCacheEntry(id,puzzle){
  try{
    const c=loadPuzzleCache();
    c[id]=puzzle;
    localStorage.setItem(PUZZLE_CACHE_KEY,JSON.stringify(c));
  }catch{}
}

// ═══════════════════════════════════════════════════
// REACT COMPONENT
// ═══════════════════════════════════════════════════
let localOpeningsDB = null;

export default function ChessEngine(){
  const[board,setBoard]=useState(initBoard);
  const[turn,setTurn]=useState('w');
  const[sel,setSel]=useState(null);
  const[lm,setLm]=useState([]);
  const[ep,setEp]=useState(null);
  const[cas,setCas]=useState('KQkq');
  const[over,setOver]=useState(null);
  const[elo,setElo]=useState(()=>loadInitialBot().elo);
  const[eloInput,setEloInput]=useState('');
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
  const[bestMoves,setBestMoves]=useState([]);
  const[analyzing,setAnalyzing]=useState(false);
  const[analysisProgress,setAnalysisProgress]=useState({current:0,total:0});
  const[reviewMode,setReviewMode]=useState(false);
  const[pvExploreStates,setPvExploreStates]=useState(null);
  const[pvExploreIdx,setPvExploreIdx]=useState(null);
  const[soundOn,setSoundOn]=useState(true);
  const[openingInfo,setOpeningInfo]=useState(null);
  const[puzzleMode,setPuzzleMode]=useState(false);
  const[puzzleData,setPuzzleData]=useState(null);
  const[puzzleStatus,setPuzzleStatus]=useState('idle');
  const[puzzleMoveIdx,setPuzzleMoveIdx]=useState(0);
  const[puzzleSolvedEval,setPuzzleSolvedEval]=useState(null);
  const[puzzleAnalysisMode,setPuzzleAnalysisMode]=useState(false);
  const[evalGraphHover,setEvalGraphHover]=useState(null);
  const[selectedBot,setSelectedBot]=useState(loadInitialBot);
  const[showBotPicker,setShowBotPicker]=useState(false);

  const bR=useRef(board);bR.current=board;
  const tR=useRef(turn);tR.current=turn;
  const eR=useRef(ep);eR.current=ep;
  const cR=useRef(cas);cR.current=cas;
  const pR=useRef(pc);pR.current=pc;
  const eloR=useRef(elo);eloR.current=elo;
  const thR=useRef(thinking);thR.current=thinking;
  const oR=useRef(over);oR.current=over;
  const capWR=useRef(capW);capWR.current=capW;
  const capBR=useRef(capB);capBR.current=capB;
  const histR=useRef(hist);histR.current=hist;
  const analysisAbortRef=useRef(false);
  const soundOnRef=useRef(soundOn);soundOnRef.current=soundOn;
  const selectedBotRef=useRef(selectedBot);selectedBotRef.current=selectedBot;

  // Stockfish worker refs (engine state, not React state)
  const sfWorkerRef=useRef(null);
  const sfReadyRef=useRef(false);
  const sfCallbackRef=useRef(null);
  const sfEvalRef=useRef(null);
  const sfPVRef=useRef('');
  const sfMultiPVRef=useRef(null); // {1:{move,cp},2:{...}} while a personality bot is searching, else null
  const sfLiveEvalRef=useRef(false);
  const sfAiSideRef=useRef(null);
  const sfHintModeRef=useRef(false);
  const sfHintCtxRef=useRef(null);
  const puzzleMoveIdxRef=useRef(0);
  const puzzleIdsRef=useRef(null);
  const puzzleCacheRef=useRef({});
  const setPMI=useCallback(n=>{puzzleMoveIdxRef.current=n;setPuzzleMoveIdx(n);},[]);

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
        if(line.startsWith('info')){
          // With MultiPV>1, Stockfish emits one info line per candidate. Only the main line
          // (multipv 1, or no multipv field) should drive the eval bar / hint PV.
          const mpvMatch=line.match(/multipv (\d+)/);
          const isMain=!mpvMatch||mpvMatch[1]==='1';
          if(line.includes('score')&&isMain){
            const cp=line.match(/score cp (-?\d+)/);
            const mt=line.match(/score mate (-?\d+)/);
            let raw=null;
            if(cp)raw=parseInt(cp[1]);
            else if(mt)raw=parseInt(mt[1])>0?99999:-99999;
            if(raw!==null){
              sfEvalRef.current=raw;
              if(sfLiveEvalRef.current){
                setEvalScore(sfAiSideRef.current==='w'?raw:-raw);
              }
            }
          }
          // Collect MultiPV candidates for personality move selection (only while a bot is searching).
          if(mpvMatch&&sfMultiPVRef.current){
            const cp=line.match(/score cp (-?\d+)/);
            const mt=line.match(/score mate (-?\d+)/);
            const first=line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/)?.[1];
            let val=null;
            if(cp)val=parseInt(cp[1]);
            else if(mt)val=parseInt(mt[1])>0?99999:-99999;
            if(first&&val!==null)sfMultiPVRef.current[parseInt(mpvMatch[1])]={move:first,cp:val};
          }
          if(line.includes(' pv ')&&isMain){
            sfPVRef.current=line;
            if(sfHintModeRef.current&&sfHintCtxRef.current){
              const {board:hb,turn:ht,ep:he}=sfHintCtxRef.current;
              const pv=parsePV(line,hb,ht,he);
              if(pv.length>0){
                const uciFirst=line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/)?.[1];
                if(uciFirst){
                  const fc='abcdefgh'.indexOf(uciFirst[0]),fr=8-parseInt(uciFirst[1]);
                  const tc='abcdefgh'.indexOf(uciFirst[2]),tr=8-parseInt(uciFirst[3]);
                  setHintMove({f:fr*8+fc,t:tr*8+tc,pv});
                }
              }
            }
          }
        }
        if(line.startsWith('bestmove')&&sfCallbackRef.current){
          const bm=line.split(' ')[1];
          const pvSnap=sfPVRef.current;
          sfPVRef.current='';
          sfCallbackRef.current(bm,sfEvalRef.current,pvSnap);
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
    setPvExploreIdx(null);setPvExploreStates(null);
    analysisAbortRef.current=true;
    setAnalysisEvals([]);setMoveClassifications([]);setBestMoves([]);setAnalyzing(false);
    setAnalysisProgress({current:0,total:0});setReviewMode(false);
    setOpeningInfo(null);
    setPuzzleMode(false);setPuzzleData(null);setPuzzleStatus('idle');setPuzzleMoveIdx(0);
    puzzleMoveIdxRef.current=0;
    setGameKey(k=>k+1);
  },[]);

  // Pick an AI opponent from the gallery → set strength + personality, persist, start a fresh game
  const selectBot=useCallback((bot)=>{
    setSelectedBot(bot);
    setElo(bot.elo);
    setEloInput('');
    try{localStorage.setItem(BOT_STORE_KEY,bot.id);}catch(e){}
    setShowBotPicker(false);
    reset();
  },[reset]);

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
    
    let isEnd=false;
    const isChk=inChk(nb,nx);
    if(!legal(nb,nx,ne,nc).length){
      if(isChk)setOver(col==='w'?'White wins!':'Black wins!');
      else setOver('Stalemate');
      isEnd=true;
    }
    
    if(soundOnRef.current){
      if(isEnd)playSound('gameEnd');
      else if(isChk)playSound('check');
      else if(m.cas)playSound('castle');
      else if(cap||m.ep)playSound('capture');
      else playSound('move');
    }
  },[]);

  // Fetch opening info for current position
  useEffect(()=>{
    if(puzzleMode){setOpeningInfo(null);return;}
    const idx = viewIdx !== null ? viewIdx : histStates.length - 1;
    if(idx > OPENING_BOOK_PLY) {
      setOpeningInfo(null);
      return;
    }
    const s = histStates[idx];
    if(!s) return;
    const fen = boardToFEN(s.board, s.turn, s.ep, s.cas);
    // The downloaded opening DB omits en-passant squares usually, so we search without it (set to '-')
    const fenNoEp = boardToFEN(s.board, s.turn, null, s.cas);
    const shortFen = fenNoEp.split(' ').slice(0, 4).join(' '); // board turn cas -

    // 1. Load local DB if not loaded
    const checkLocalAndFetch = async () => {
      if (!localOpeningsDB) {
        try {
          const res = await fetch('/openings.json');
          if (res.ok) {
            localOpeningsDB = await res.json();
          }
        } catch(e) { console.warn('Failed to load local openings', e); }
      }

      // 2. Check local DB first for instant response
      let localMatch = null;
      if (localOpeningsDB && localOpeningsDB[shortFen]) {
        localMatch = localOpeningsDB[shortFen];
        // Instantly show local name
        setOpeningInfo(prev => ({ ...prev, opening: localMatch, outOfBook: false }));
      } else {
        // If not in local DB, it might be out of book, but we wait for Lichess to confirm
        setOpeningInfo(prev => prev ? { ...prev, outOfBook: false } : { outOfBook: false });
      }

      // 3. Fetch Lichess API for move statistics (silently in background)
      let active = true;
      getOpeningData(fen).then(data => {
        if(!active) return;
        if(data && (data.opening || (data.moves && data.moves.length > 0))) {
          setOpeningInfo({
            opening: localMatch || data.opening, // Prefer local name if available
            moves: data.moves,
            outOfBook: false
          });
        } else {
          // Only mark out of book if both local and Lichess fail
          if (!localMatch) {
            setOpeningInfo({ outOfBook: true });
          }
        }
      });
      return () => { active = false; };
    };

    const cleanup = checkLocalAndFetch();
    return () => { cleanup.then(c => c && c()); };
  },[viewIdx, histStates, puzzleMode]);

  // AI turn – Stockfish preferred; built-in alpha-beta as fallback
  useEffect(()=>{
    if(puzzleMode)return;
    const aiC=pR.current==='w'?'b':'w';
    if(turn!==aiC||oR.current||thR.current)return;
    setThinking(true);
    const b=bR.current,e=eR.current,c=cR.current;
    
    // Find nearest DIFFS entry for search parameters (depth, time)
    const currentElo=eloR.current;
    const d=DIFFS.reduce((prev,curr)=>Math.abs(curr.elo-currentElo)<Math.abs(prev.elo-currentElo)?curr:prev);

    // Active opponent personality (named bots only; CUSTOM_BOT carries a neutral style)
    const bot=selectedBotRef.current;
    const style=bot&&bot.style;
    const personalityActive=!!style&&(style.blunderRate>0||Math.abs(style.aggression)>=0.05);

    // Opening identity: a bot signs its first move as White (engine-agnostic, runs before any search)
    if(style&&style.openings&&style.openings.length&&aiC==='w'&&histR.current.length===0){
      const legals=legal(b,aiC,e,c);
      const pick=style.openings.map(u=>uciToMove(u,b,aiC,e)).find(m=>m&&legals.some(L=>L.f===m.f&&L.t===m.t));
      if(pick){
        setSearchInfo(`${bot.name} · Opening`);
        applyMv(b,pick,e,c,aiC);
        setThinking(false);
        return;
      }
    }

    if(sfReadyRef.current&&sfWorkerRef.current){
      let cancelled=false;
      const fen=boardToFEN(b,aiC,e,c);
      // Halt any lingering background eval search before the AI takes over the worker
      sfLiveEvalRef.current=false;
      sfWorkerRef.current.postMessage('stop');

      const runEngine=()=>{
        if(cancelled)return;
        sfEvalRef.current=null;
        sfMultiPVRef.current=personalityActive?{}:null;
        sfLiveEvalRef.current=true;
        sfAiSideRef.current=aiC;
        sfCallbackRef.current=(uciMove,sfEval)=>{
          sfLiveEvalRef.current=false;
          if(sfWorkerRef.current)sfWorkerRef.current.postMessage('setoption name MultiPV value 1'); // restore for other searches
          const cands=sfMultiPVRef.current?Object.values(sfMultiPVRef.current):null;
          sfMultiPVRef.current=null;
          if(cancelled)return;
          let finalUci=uciMove;
          if(personalityActive&&cands&&cands.length)finalUci=pickByPersonality(cands,style,uciMove,b,e,aiC);
          if(finalUci&&finalUci!=='(none)'){
            const m=uciToMove(finalUci,b,aiC,e);
            const chosen=cands&&cands.find(cc=>cc.move===finalUci);
            const evalCp=chosen?chosen.cp:sfEval;
            setEvalScore(evalCp!==null&&evalCp!==undefined?(aiC==='w'?evalCp:-evalCp):null);
            setSearchInfo(`${bot&&bot.id!=='custom'?bot.name:'Stockfish'} · ELO ${currentElo}`);
            applyMv(b,m,e,c,aiC);
          }
          setThinking(false);
        };
        if (currentElo >= UCI_ELO_MIN) {
          sfWorkerRef.current.postMessage('setoption name UCI_LimitStrength value true');
          sfWorkerRef.current.postMessage(`setoption name UCI_Elo value ${currentElo}`);
        } else {
          sfWorkerRef.current.postMessage('setoption name UCI_LimitStrength value false');
          sfWorkerRef.current.postMessage(`setoption name Skill Level value ${d.skill}`);
        }
        sfWorkerRef.current.postMessage(`setoption name MultiPV value ${personalityActive?3:1}`);
        sfWorkerRef.current.postMessage(`position fen ${fen}`);
        sfWorkerRef.current.postMessage(`go depth ${d.depth+4} movetime ${d.time}`);
      };

      // Opening book: ELO 1200(Club) 이상 난이도, 20수 이내에서 Lichess master DB 조회
      if(currentElo>=1200&&histR.current.length<20){
        getOpeningMove(fen).then(bookMoves=>{
          if(cancelled)return;
          if(bookMoves&&bookMoves.length>0){
            const m=uciToMove(bookMoves[0],b,aiC,e);
            setSearchInfo('Opening Book');
            applyMv(b,m,e,c,aiC);
            setThinking(false);
          }else{
            runEngine();
          }
        });
      }else{
        runEngine();
      }

      return()=>{
        cancelled=true;
        sfLiveEvalRef.current=false;
        sfCallbackRef.current=null;
        sfMultiPVRef.current=null;
        if(sfWorkerRef.current){sfWorkerRef.current.postMessage('stop');sfWorkerRef.current.postMessage('setoption name MultiPV value 1');}
      };
    }

    const tid=setTimeout(()=>{
      // Fallback engine: nudge its move noise up for blunder-prone bots (personality, best-effort)
      const fbRand=Math.round(d.rand*(1+(style?style.blunderRate:0)*2));
      const result=findBestMove(b,e,c,aiC,d.depth,d.time,fbRand);
      if(result&&result.move){
        setEvalScore(result.eval);
        setSearchInfo(`depth ${Math.min(result.depth||d.depth,d.depth)} · ${(nodeCount/1000).toFixed(0)}k nodes`);
        applyMv(b,result.move,e,c,aiC);
      }
      setThinking(false);
    },50);
    return()=>clearTimeout(tid);
  },[turn,applyMv,gameKey,puzzleMode]);

  // Live eval bar on the player's own turn — without this the bar only updates
  // while the AI is thinking, so it lagged a full move behind the player's input.
  // Mirrors the puzzle-mode live-eval effect; the single worker is shared turn-by-turn.
  useEffect(()=>{
    if(puzzleMode||viewIdx!==null||over)return;
    if(turn!==pc||thinking||hintThinking||hintMove)return;
    if(!sfReadyRef.current||!sfWorkerRef.current)return;
    const b=board,e=eR.current,c=cR.current,t=turn;
    sfHintModeRef.current=false;
    sfCallbackRef.current=null;
    sfLiveEvalRef.current=true;
    sfAiSideRef.current=t;
    sfWorkerRef.current.postMessage('stop');
    // Evaluate objectively (full strength) — the AI turn re-sets its own weakened
    // options before moving, so this only affects the eval-bar read.
    sfWorkerRef.current.postMessage('setoption name UCI_LimitStrength value false');
    sfWorkerRef.current.postMessage('setoption name Skill Level value 20');
    sfWorkerRef.current.postMessage('setoption name MultiPV value 1');
    sfWorkerRef.current.postMessage(`position fen ${boardToFEN(b,t,e,c)}`);
    sfWorkerRef.current.postMessage(`go movetime ${LIVE_EVAL_MOVETIME_MS}`);
    // No 'stop' in cleanup: the next worker owner (AI turn / hint) issues its own
    // 'stop' before searching, so stopping here would abort a hint that just started.
    return()=>{sfLiveEvalRef.current=false;};
  },[board,turn,thinking,hintThinking,hintMove,puzzleMode,viewIdx,over,pc]);

  const enterPVExplore=useCallback((originBoard,originTurn,originEp,originCas,originLast,pvMoves)=>{
    const states=[{board:originBoard,turn:originTurn,last:originLast}];
    let curBd=originBoard,curTurn=originTurn,curEp=originEp,curCas=originCas;
    for(const mv of pvMoves){
      const nb=doMv(curBd,mv);
      const nc=updCas(curCas,mv,curBd);
      const ne=nextEp(mv);
      states.push({board:nb,turn:curTurn==='w'?'b':'w',last:{f:mv.f,t:mv.t}});
      curBd=nb;curTurn=curTurn==='w'?'b':'w';curEp=ne;curCas=nc;
    }
    setPvExploreStates(states);
    setPvExploreIdx(1);
  },[]);

  const exitPVExplore=useCallback(()=>{
    setPvExploreIdx(null);setPvExploreStates(null);
  },[]);

  const loadPuzzleIndex=useCallback(async()=>{
    if(puzzleIdsRef.current)return;
    const r=await fetch('/puzzle-ids.json');
    if(!r.ok)throw new Error('puzzle index unavailable');
    puzzleIdsRef.current=await r.json();
    puzzleCacheRef.current=loadPuzzleCache();
  },[]);

  const fetchPuzzleById=useCallback(async(id)=>{
    if(puzzleCacheRef.current[id])return puzzleCacheRef.current[id];
    const r=await fetch(`https://lichess.org/api/puzzle/${id}`);
    if(!r.ok)throw new Error(`puzzle ${id} fetch failed`);
    const data=await r.json();
    if(!data?.puzzle?.fen||!data?.puzzle?.solution?.length)throw new Error('invalid puzzle data');
    const pz=lichessToInternal(data);
    puzzleCacheRef.current[id]=pz;
    savePuzzleCacheEntry(id,pz);
    return pz;
  },[]);

  const enterPuzzleMode=useCallback(async()=>{
    try{await loadPuzzleIndex();}
    catch{alert('퍼즐 인덱스를 불러올 수 없습니다.\n`npm run puzzles` 실행 후 새로고침해주세요.');return;}
    const idx=puzzleIdsRef.current;
    if(!idx?.length){alert('퍼즐 풀이 비어있습니다. `npm run puzzles`를 실행하세요.');return;}
    const center=Math.min(3000,eloR.current+600);
    const currentId=puzzleData?.id;
    let pool=idx.filter(p=>p.rating>=center-200&&p.rating<=center+200&&p.id!==currentId);
    if(!pool.length)pool=idx.filter(p=>p.rating>=center-200&&p.rating<=center+200);
    if(!pool.length)pool=idx.filter(p=>p.id!==currentId);
    if(!pool.length)pool=idx;
    const pick=pool[Math.floor(Math.random()*pool.length)];
    setPuzzleStatus('loading');
    let pz;
    try{pz=await fetchPuzzleById(pick.id);}
    catch{
      alert('Lichess 퍼즐 fetch 실패. 인터넷 연결을 확인하세요.');
      setPuzzleStatus('idle');return;
    }
    const{board:pb,turn:pt,cas:pc_,ep:pe}=fenToBoard(pz.fen);
    // Lichess convention: solution[0] is the SOLVER's first move.
    // The player's color matches the FEN turn (whoever is to move).
    const playerCol=pt;
    // Parse hook move from puzzle-ids.json entry (CSV-generated, may be absent)
    const hookLast=(()=>{
      const h=pick.hook;
      if(!h||h.length<4)return null;
      const fc='abcdefgh'.indexOf(h[0]),fr=8-parseInt(h[1]);
      const tc='abcdefgh'.indexOf(h[2]),tr=8-parseInt(h[3]);
      if(fc<0||tc<0||isNaN(fr)||isNaN(tr))return null;
      return{f:fr*8+fc,t:tr*8+tc};
    })();
    setBoard(pb);setTurn(pt);setCas(pc_);setEp(pe);setSel(null);setLm([]);
    setOver(null);setThinking(false);setLast(hookLast);setCapW([]);setCapB([]);setHist([]);
    setPromo(null);setPc(playerCol);setEvalScore(null);setSearchInfo('');
    setHistStates([{board:pb,turn:pt,ep:pe,cas:pc_,last:hookLast,capW:[],capB:[]}]);
    setViewIdx(null);setHintMove(null);setHintThinking(false);
    setPvExploreIdx(null);setPvExploreStates(null);
    analysisAbortRef.current=true;
    setAnalysisEvals([]);setMoveClassifications([]);setBestMoves([]);
    setAnalyzing(false);setAnalysisProgress({current:0,total:0});
    setReviewMode(false);setOpeningInfo(null);setPuzzleAnalysisMode(false);
    setPMI(0);
    setPuzzleData(pz);
    setPuzzleSolvedEval(null);
    setPuzzleStatus('playing');
    setPuzzleMode(true);
  },[loadPuzzleIndex,fetchPuzzleById,puzzleData,setPMI]);

  const exitPuzzleMode=useCallback(()=>reset(),[reset]);

  // When puzzle is solved, kick off a Stockfish eval on the final position
  useEffect(()=>{
    if(!puzzleMode||puzzleStatus!=='solved')return;
    if(!sfReadyRef.current||!sfWorkerRef.current){setPuzzleSolvedEval(null);return;}
    setPuzzleSolvedEval(null);
    const b=bR.current,e=eR.current,c=cR.current,t=tR.current;
    const playerSide=pR.current;
    const w=sfWorkerRef.current;
    sfCallbackRef.current=(_uciMove,sfEval)=>{
      if(sfEval==null){setPuzzleSolvedEval(null);return;}
      // sfEval is from side-to-move perspective; flip to player perspective
      const fromWhite=t==='w'?sfEval:-sfEval;
      const fromPlayer=playerSide==='w'?fromWhite:-fromWhite;
      setPuzzleSolvedEval(fromPlayer);
    };
    sfLiveEvalRef.current=false;
    sfHintModeRef.current=false;
    w.postMessage('setoption name UCI_LimitStrength value false');
    w.postMessage('setoption name Skill Level value 20');
    w.postMessage('setoption name MultiPV value 1');
    w.postMessage(`position fen ${boardToFEN(b,t,e,c)}`);
    w.postMessage('go depth 14');
    return()=>{sfCallbackRef.current=null;};
  },[puzzleMode,puzzleStatus]);

  // Auto-play opponent moves in puzzle mode (odd indices: 1, 3, 5, ...).
  // Player moves are at even indices (0, 2, 4, ...) and clicked by the user.
  useEffect(()=>{
    if(!puzzleMode||!puzzleData||puzzleStatus!=='playing')return;
    const idx=puzzleMoveIdxRef.current;
    if(idx%2!==1||idx>=puzzleData.moves.length)return;
    const b=bR.current,e=eR.current,c=cR.current,t=tR.current;
    const timer=setTimeout(()=>{
      const m=uciToMove(puzzleData.moves[idx],b,t,e);
      if(m){
        applyMv(b,m,e,c,t);
        const next=idx+1;
        setPMI(next);
        if(next>=puzzleData.moves.length)setPuzzleStatus('solved');
      }
    },500);
    return()=>clearTimeout(timer);
  },[puzzleMode,puzzleData,puzzleStatus,board,turn,applyMv,setPMI]);

  // Live eval bar update during puzzle play — triggered on each move
  useEffect(()=>{
    if(!puzzleMode||puzzleStatus!=='playing')return;
    if(!sfReadyRef.current||!sfWorkerRef.current)return;
    const b=bR.current,e=eR.current,c=cR.current,t=tR.current;
    sfHintModeRef.current=false;
    sfCallbackRef.current=null;
    sfLiveEvalRef.current=true;
    sfAiSideRef.current=t;
    sfWorkerRef.current.postMessage('stop');
    sfWorkerRef.current.postMessage('setoption name MultiPV value 1');
    sfWorkerRef.current.postMessage(`position fen ${boardToFEN(b,t,e,c)}`);
    sfWorkerRef.current.postMessage('go movetime 500');
    return()=>{
      sfLiveEvalRef.current=false;
      sfWorkerRef.current?.postMessage('stop');
    };
  },[puzzleMode,puzzleStatus,puzzleMoveIdx]);

  const click=useCallback((idx)=>{
    if(viewIdx!==null||pvExploreIdx!==null||turn!==pc||over||thinking)return;
    if(puzzleMode&&puzzleStatus!=='playing')return;
    const myP=pc==='w'?isW:isB;
    const myPawn=pc==='w'?WP:BP;
    const pRow=pc==='w'?0:7;
    if(sel!==null){
      const m=lm.find(m=>m.t===idx);
      if(m){
        if(board[sel]===myPawn&&toRC(idx)[0]===pRow){setPromo({f:sel,t:idx,mvs:lm.filter(m=>m.t===idx)});return}
        if(puzzleMode&&puzzleData){
          const expM=uciToMove(puzzleData.moves[puzzleMoveIdxRef.current],board,turn,ep);
          if(!expM||m.f!==expM.f||m.t!==expM.t){
            setPuzzleStatus('fail');
            setTimeout(()=>setPuzzleStatus(s=>s==='fail'?'playing':s),1200);
            setSel(null);setLm([]);return;
          }
          applyMv(board,m,ep,cas,pc);setSel(null);setLm([]);
          const next=puzzleMoveIdxRef.current+1;
          setPMI(next);
          if(next>=puzzleData.moves.length)setPuzzleStatus('solved');
          return;
        }
        applyMv(board,m,ep,cas,pc);setSel(null);setLm([]);return;
      }
      if(myP(board[idx])){setSel(idx);setLm(legal(board,pc,ep,cas).filter(m=>m.f===idx));return}
      setSel(null);setLm([]);return}
    if(myP(board[idx])){setSel(idx);setLm(legal(board,pc,ep,cas).filter(m=>m.f===idx))}
  },[sel,lm,board,turn,over,thinking,ep,cas,applyMv,viewIdx,pc,puzzleMode,puzzleStatus,puzzleData,setPMI]);

  const doPromo=useCallback(m=>{
    if(puzzleMode&&puzzleData){
      const expM=uciToMove(puzzleData.moves[puzzleMoveIdxRef.current],board,turn,ep);
      if(!expM||m.f!==expM.f||m.t!==expM.t||(expM.pr&&m.pr!==expM.pr)){
        setPuzzleStatus('fail');
        setTimeout(()=>setPuzzleStatus(s=>s==='fail'?'playing':s),1200);
        setPromo(null);setSel(null);setLm([]);return;
      }
      applyMv(board,m,ep,cas,pc);setSel(null);setLm([]);setPromo(null);
      const next=puzzleMoveIdxRef.current+1;
      setPMI(next);
      if(next>=puzzleData.moves.length)setPuzzleStatus('solved');
      return;
    }
    applyMv(board,m,ep,cas,pc);setSel(null);setLm([]);setPromo(null);
  },[board,ep,cas,pc,turn,applyMv,puzzleMode,puzzleData,setPMI]);
  const swap=useCallback(()=>setPc(p=>p==='w'?'b':'w'),[]);

  const handleHint=useCallback(()=>{
    if(hintMove||hintThinking){
      sfHintModeRef.current=false;
      sfHintCtxRef.current=null;
      sfCallbackRef.current=null;
      setHintMove(null);
      setHintThinking(false);
      return;
    }
    if(thinking||over||viewIdx!==null)return;
    setHintThinking(true);
    const b=board,e=ep,c=cas,t=turn;
    if(sfReadyRef.current&&sfWorkerRef.current){
      sfHintModeRef.current=true;
      sfHintCtxRef.current={board:b,turn:t,ep:e};
      sfCallbackRef.current=(uciMove,_sfEval,pvLine)=>{
        sfHintModeRef.current=false;
        sfHintCtxRef.current=null;
        // 실시간 업데이트로 이미 PV가 있으면 덮어쓰지 않음
        setHintMove(prev=>{
          if(prev&&prev.pv?.length>0)return prev;
          if(uciMove&&uciMove!=='(none)'){
            const fc='abcdefgh'.indexOf(uciMove[0]),fr=8-parseInt(uciMove[1]);
            const tc='abcdefgh'.indexOf(uciMove[2]),tr=8-parseInt(uciMove[3]);
            const pv=pvLine?parsePV(pvLine,b,t,e):[];
            return{f:fr*8+fc,t:tr*8+tc,pv};
          }
          return prev;
        });
        setHintThinking(false);
      };
      sfLiveEvalRef.current=false;
      sfWorkerRef.current.postMessage('stop');
      sfWorkerRef.current.postMessage('setoption name UCI_LimitStrength value false');
      sfWorkerRef.current.postMessage('setoption name UCI_Elo value 3200');
      sfWorkerRef.current.postMessage('setoption name Skill Level value 20');
      sfWorkerRef.current.postMessage('setoption name MultiPV value 1');
      sfWorkerRef.current.postMessage(`position fen ${boardToFEN(b,t,e,c)}`);
      sfWorkerRef.current.postMessage(`go movetime ${HINT_MOVETIME_MS}`);
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

  const handleSurrender=useCallback(()=>{
    if(over||thinking)return;
    if(sfWorkerRef.current)sfWorkerRef.current.postMessage('stop');
    setThinking(false);
    setOver(pc==='w'?'Black wins!':'White wins!');
  },[over,thinking,pc]);

  // SAN notation for each half-move (sanList[k] ↔ hist[k]); memoized on the move history
  const sanList=useMemo(()=>{
    const out=[];
    for(let i=1;i<histStates.length;i++){
      const mvo=histStates[i].last;
      if(!mvo){out.push('');continue;}
      out.push(toSAN(histStates[i-1].board,histStates[i].board,mvo,histStates[i-1].ep??null,histStates[i-1].cas??'KQkq'));
    }
    return out;
  },[histStates]);

  const handleExportPGN=useCallback(()=>{
    if(histStates.length<2)return;
    const pgn=sanList.reduce((acc,curr,idx)=>{
      if(idx%2===0)return acc+`${Math.floor(idx/2)+1}. ${curr} `;
      return acc+`${curr} `;
    },'').trim();

    navigator.clipboard.writeText(pgn).then(()=>{
      alert('PGN(SAN 형식)이 클립보드에 복사되었습니다.');
    }).catch(e=>console.error('PGN export failed:',e));
  },[sanList,histStates]);

  const handleImportPGN=useCallback(()=>{
    if(thinking)return;
    const input=prompt('PGN을 붙여넣으세요 (SAN 예: 1. e4 e5 2. Nf3 / UCI 예: 1. e2e4 e7e5):');
    if(!input)return;

    // Strip comments, variations, NAGs, move numbers and result markers — keep SAN/UCI tokens
    const clean=input
      .replace(/\{[^}]*\}/g,' ')
      .replace(/\([^)]*\)/g,' ')
      .replace(/\$\d+/g,' ')
      .replace(/\d+\.(\.\.)?/g,' ')
      .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g,' ')
      .replace(/\s+/g,' ').trim();
    const tokens=clean.split(' ').filter(t=>t.length>0);

    if(tokens.length===0){
      alert('유효한 기보를 찾을 수 없습니다.');
      return;
    }

    // Reset board first
    reset();
    
    // We need to apply moves sequentially. 
    // Since we are not using full Stockfish for import to avoid complexity in this step,
    // we'll apply them using our internal engine logic sequentially with a small delay.
    let currentBoard=initBoard();
    let currentTurn='w';
    let currentEp=null;
    let currentCas='KQkq';
    let validMoves=0;
    
    const applyNext=(idx)=>{
      if(idx>=tokens.length){
        setGameKey(k=>k+1); // Force full re-render
        return;
      }
      
      const tok=tokens[idx];
      // Accept both UCI (e2e4) and SAN (e4, Nf3, O-O, exd5, e8=Q+)
      const m=/^[a-h][1-8][a-h][1-8][qrbnQRBN]?$/.test(tok)
        ? uciToMove(tok,currentBoard,currentTurn,currentEp)
        : sanToMove(tok,currentBoard,currentTurn,currentEp,currentCas);

      // Safety check: is it a pseudo-legal move structure?
      if(!m||m.f<0||m.t<0||m.f>63||m.t>63){
        console.warn('Invalid move in sequence:',tok);
        return;
      }

      const cap=currentBoard[m.t];
      const nb=doMv(currentBoard,m);
      const nc=updCas(currentCas,m,currentBoard);
      const ne=nextEp(m);
      const nx=currentTurn==='w'?'b':'w';
      
      currentBoard=nb;
      currentTurn=nx;
      currentEp=ne;
      currentCas=nc;
      validMoves++;

      setBoard(currentBoard);setCas(currentCas);setEp(currentEp);setLast({f:m.f,t:m.t});
      setTurn(currentTurn);
      setHist(p=>[...p,`${SYM[currentBoard[m.f]]||''}${FL[m.f&7]}${RL[m.f>>3]}→${FL[m.t&7]}${RL[m.t>>3]}`]);
      
      // Update history state
      setHistStates(p=>{
        const prevCapW=p.length>0?p[p.length-1].capW:[];
        const prevCapB=p.length>0?p[p.length-1].capB:[];
        const newCapW=[...prevCapW,...(cap&&isW(cap)?[cap]:[]),...(m.ep&&nx==='w'?[WP]:[])];
        const newCapB=[...prevCapB,...(cap&&isB(cap)?[cap]:[]),...(m.ep&&nx==='b'?[BP]:[])];
        setCapW(newCapW);setCapB(newCapB);
        return [...p,{board:currentBoard,turn:currentTurn,ep:currentEp,cas:currentCas,last:{f:m.f,t:m.t},capW:newCapW,capB:newCapB}];
      });

      // Continue to next move rapidly
      setTimeout(()=>applyNext(idx+1),20);
    };
    
    // Start sequence
    setTimeout(()=>applyNext(0),100);
    
  },[thinking,reset]);

  const runPuzzleAnalysis=useCallback(()=>{
    if(analyzing||histStates.length<2)return;
    analysisAbortRef.current=false;
    setAnalyzing(true);
    const total=histStates.length;
    setAnalysisProgress({current:0,total});
    const evals=new Array(total).fill(null);
    const bestMovesArr=new Array(total).fill(null);
    let idx=0;
    sfLiveEvalRef.current=false;
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
          const playerEval=t==='w'?ei:-ei;
          let rawLoss=t==='w'?Math.max(0,ei-ei1):Math.max(0,ei1-ei);
          const bm=bestMovesArr[i],played=histStates[i+1]?.last;
          if(bm&&played&&bm.f===played.f&&bm.t===played.t)rawLoss=0;
          let cpLoss=rawLoss;
          if(playerEval<-500)cpLoss=Math.min(cpLoss,100);
          else if(playerEval<-200)cpLoss=Math.min(cpLoss,200);
          cls.push({cpLoss,player:t,grade:classifyMove(cpLoss)});
        }
        setAnalysisEvals([...evals]);setMoveClassifications(cls);setBestMoves([...bestMovesArr]);
        setAnalyzing(false);setPuzzleAnalysisMode(true);setViewIdx(0);
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
          if(uciMove&&uciMove!=='(none)'&&uciMove.length>=4){
            const fc='abcdefgh'.indexOf(uciMove[0]),fr=8-parseInt(uciMove[1]);
            const tc='abcdefgh'.indexOf(uciMove[2]),tr=8-parseInt(uciMove[3]);
            if(fc>=0&&tc>=0){
              const pv=sfPVRef.current?parsePV(sfPVRef.current,s.board,s.turn,s.ep):[];
              bestMovesArr[idx]={f:fr*8+fc,t:tr*8+tc,pv};
            }
          }
          evals[idx]=sfEval!=null?(s.turn==='w'?sfEval:-sfEval):0;
          idx++;
          setTimeout(next,30);
        };
        sfCallbackRef.current=doNext;
        watchdog=setTimeout(()=>{
          if(sfCallbackRef.current===doNext){sfCallbackRef.current=null;doNext(null,sfEvalRef.current);}
        },ANALYSIS_TIMEOUT_MS);
        sfWorkerRef.current.postMessage('setoption name Skill Level value 20');
        sfWorkerRef.current.postMessage('setoption name MultiPV value 1');
        sfWorkerRef.current.postMessage(`position fen ${boardToFEN(s.board,s.turn,s.ep,s.cas)}`);
        sfWorkerRef.current.postMessage(`go depth ${ANALYSIS_DEPTH}`);
      }else{
        const r=findBestMove(s.board,s.ep,s.cas,s.turn,4,800,0);
        evals[idx]=r?(s.turn==='w'?r.eval:-r.eval):0;
        idx++;
        setTimeout(next,0);
      }
    };
    next();
  },[analyzing,histStates]);

  const runAnalysis=useCallback(()=>{
    if(analyzing||histStates.length<2)return;
    analysisAbortRef.current=false;
    setAnalyzing(true);setReviewMode(false);
    const total=histStates.length;
    setAnalysisProgress({current:0,total});
    const evals=new Array(total).fill(null);
    const bestMovesArr=new Array(total).fill(null);
    const bookHits=new Array(Math.max(0,total-1)).fill(false);
    let idx=0;
    // Clean Stockfish state before starting
    sfLiveEvalRef.current=false; // 분석 중 실시간 eval 업데이트 차단
    if(sfReadyRef.current&&sfWorkerRef.current){
      sfWorkerRef.current.postMessage('stop');
      sfWorkerRef.current.postMessage('ucinewgame');
    }
    // Pre-fetch opening book: check first 20 plies in parallel via Lichess API
    const openingCount=Math.min(20,total-1);
    const bookPromises=[];
    for(let i=0;i<openingCount;i++){
      const s=histStates[i];
      const fen=boardToFEN(s.board,s.turn,s.ep,s.cas);
      bookPromises.push(
        getOpeningMove(fen).then(bookMoves=>{
          if(bookMoves&&histStates[i+1]?.last){
            const last=histStates[i+1].last;
            const playedUCI=FL[last.f&7]+RL[last.f>>3]+FL[last.t&7]+RL[last.t>>3];
            if(bookMoves.some(m=>m.startsWith(playedUCI)))bookHits[i]=true;
          }
        }).catch(()=>{})
      );
    }
    Promise.all(bookPromises).then(()=>{
      if(analysisAbortRef.current){setAnalyzing(false);return;}
      const next=()=>{
        if(analysisAbortRef.current){setAnalyzing(false);return;}
        if(idx>=total){
          const cls=[];
          for(let i=0;i<total-1;i++){
            const t=histStates[i].turn;
            const ei=evals[i]??0,ei1=evals[i+1]??0;
            const playerEval=t==='w'?ei:-ei;
            let rawLoss=t==='w'?Math.max(0,ei-ei1):Math.max(0,ei1-ei);
            // 실제로 둔 수가 최선의 수와 같으면 독립 분석 불일치 무관하게 손실 0
            const bm=bestMovesArr[i];
            const played=histStates[i+1]?.last;
            if(bm&&played&&bm.f===played.f&&bm.t===played.t)rawLoss=0;
            // 이미 크게 지고 있으면 cpLoss 상한 적용 — 패배 확정 국면의 블런더 과잉 처벌 방지
            let cpLoss=rawLoss;
            if(playerEval<-500)cpLoss=Math.min(cpLoss,100);
            else if(playerEval<-200)cpLoss=Math.min(cpLoss,200);
            cpLoss=bookHits[i]?0:cpLoss;
            cls.push({cpLoss,player:t,grade:classifyMove(cpLoss)});
          }
          setAnalysisEvals([...evals]);setMoveClassifications(cls);setBestMoves([...bestMovesArr]);
          setAnalyzing(false);setReviewMode(true);
          return;
        }
        const s=histStates[idx];
        setAnalysisProgress({current:idx+1,total});
        if(sfReadyRef.current&&sfWorkerRef.current){
          sfEvalRef.current=null;
          let watchdog=null;
          const doNext=(uciMove,sfEval,pvLine)=>{
            if(watchdog){clearTimeout(watchdog);watchdog=null;}
            if(analysisAbortRef.current){setAnalyzing(false);return;}
            if(uciMove&&uciMove!=='(none)'&&uciMove.length>=4){
              const fc='abcdefgh'.indexOf(uciMove[0]),fr=8-parseInt(uciMove[1]);
              const tc='abcdefgh'.indexOf(uciMove[2]),tr=8-parseInt(uciMove[3]);
              if(fc>=0&&fr>=0&&fr<8&&tc>=0&&tr>=0&&tr<8){
                const pv=pvLine?parsePV(pvLine,s.board,s.turn,s.ep):[];
                bestMovesArr[idx]={f:fr*8+fc,t:tr*8+tc,pv};
              }
            }
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
          },ANALYSIS_TIMEOUT_MS);
          sfWorkerRef.current.postMessage('setoption name Skill Level value 20');
          sfWorkerRef.current.postMessage('setoption name MultiPV value 1');
          sfWorkerRef.current.postMessage(`position fen ${boardToFEN(s.board,s.turn,s.ep,s.cas)}`);
          sfWorkerRef.current.postMessage(`go depth ${ANALYSIS_DEPTH}`); // depth-only: predictable finish time
        }else{
          const r=findBestMove(s.board,s.ep,s.cas,s.turn,4,800,0);
          evals[idx]=r?(s.turn==='w'?r.eval:-r.eval):0;
          idx++;
          setTimeout(next,0);
        }
      };
      next();
    });
  },[analyzing,histStates]);

  const renderEvalGraph=()=>{
    if(analysisEvals.length<2)return null;
    const W=400,H=150,MAXE=600,n=analysisEvals.length;
    const xS=i=>Math.round((i/(n-1))*W);
    const yS=e=>{const c=Math.max(-MAXE,Math.min(MAXE,e??0));return Math.round(H/2-(c/MAXE)*(H/2-12));};
    const pts=analysisEvals.map((e,i)=>[xS(i),yS(e)]);
    const line=pts.map(([x,y],i)=>`${i===0?'M':'L'}${x} ${y}`).join(' ');
    const fillArea=`${line} L${xS(n-1)} ${H} L${xS(0)} ${H}Z`;
    const GCOL={best:'#3cdc82',excellent:'#89d4f0',good:'#6abf69',inaccuracy:'#f0c040',mistake:'#e8a040',blunder:'#e05050'};
    
    return(
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:'block',borderRadius:8,background:'#111',boxShadow:'inset 0 0 20px rgba(0,0,0,0.8)'}} preserveAspectRatio="none">
        <defs>
          <linearGradient id="neonGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#e8d5b5" stopOpacity="1" />
            <stop offset="50%" stopColor="#f0c040" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#e05050" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="glowFill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(232,213,181,0.15)" />
            <stop offset="50%" stopColor="rgba(240,192,64,0.05)" />
            <stop offset="100%" stopColor="rgba(224,80,80,0.2)" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Advantage zones */}
        <rect x={0} y={0} width={W} height={H/2} fill="rgba(255,255,255,0.05)"/>
        <rect x={0} y={H/2} width={W} height={H/2} fill="rgba(0,0,0,0.18)"/>
        {/* Grid lines */}
        <line x1={0} y1={H/4} x2={W} y2={H/4} stroke="rgba(255,255,255,0.03)" strokeWidth={1}/>
        <line x1={0} y1={H/2} x2={W} y2={H/2} stroke="rgba(255,255,255,0.25)" strokeWidth={1} strokeDasharray="4,4"/>
        <line x1={0} y1={(H/4)*3} x2={W} y2={(H/4)*3} stroke="rgba(255,255,255,0.03)" strokeWidth={1}/>
        <line x1={0} y1={yS(300)} x2={W} y2={yS(300)} stroke="rgba(255,255,255,0.07)" strokeWidth={1}/>
        <line x1={0} y1={yS(-300)} x2={W} y2={yS(-300)} stroke="rgba(255,255,255,0.07)" strokeWidth={1}/>

        {/* Graph Area Fill */}
        <path d={fillArea} fill="url(#glowFill)" />
        
        {/* Main Neon Line */}
        <path d={line} fill="none" stroke="url(#neonGrad)" strokeWidth={2.5} filter="url(#glow)"/>

        {/* Current position glowing line */}
        {effectiveIdx>=0&&effectiveIdx<n&&(
          <g>
            <line x1={xS(effectiveIdx)} y1={0} x2={xS(effectiveIdx)} y2={H} stroke="rgba(240,192,64,0.4)" strokeWidth={4} filter="url(#glow)"/>
            <line x1={xS(effectiveIdx)} y1={0} x2={xS(effectiveIdx)} y2={H} stroke="#f0c040" strokeWidth={1.5}/>
          </g>
        )}

        {/* Move dots */}
        {moveClassifications.map((mc,i)=>{
          const x=xS(i+1),y=yS(analysisEvals[i+1]);
          const isCurrent=effectiveIdx===i+1;
          const col=GCOL[mc.grade]||'#888';
          return(
            <g key={i} style={{cursor:'pointer'}} onClick={()=>setViewIdx(i+1)}
              onMouseEnter={e=>{
                const mv=histStates[i+1]?.last;
                const label=mv?`${FL[mv.f&7]}${RL[mv.f>>3]}→${FL[mv.t&7]}${RL[mv.t>>3]}`:'?';
                setEvalGraphHover({clientX:e.clientX,clientY:e.clientY,label:`${i+1}. ${label}`,cls:mc.grade,evalVal:analysisEvals[i+1]});
              }}
              onMouseLeave={()=>setEvalGraphHover(null)}>
              {isCurrent&&<circle cx={x} cy={y} r={12} fill={col} opacity={0.2} filter="url(#glow)"/>}
              <circle cx={x} cy={y} r={isCurrent?5.5:3.5} fill={isCurrent?col:'#222'} stroke={col} strokeWidth={isCurrent?2:1.5}/>
            </g>
          );
        })}
      </svg>
    );
  };

  const chk=!over&&inChk(board,turn);

  // Eval bar – 500cp(5점) = 거의 꽉 참
  const effectiveEval=viewIdx!==null?(analysisEvals[viewIdx]??null):evalScore;
  const evalPct=(()=>{
    if(effectiveEval===null)return 50;
    if(effectiveEval>=9999)return 96;if(effectiveEval<=-9999)return 4;
    return Math.max(4,Math.min(96, 50+(effectiveEval/500)*46));
  })();
  const evalText=effectiveEval===null?'0.0':Math.abs(effectiveEval)>=9999?(effectiveEval>0?'M+':'M-'):`${effectiveEval>0?'+':''}${(effectiveEval/100).toFixed(1)}`;

  // Navigation
  const effectiveIdx=viewIdx!==null?viewIdx:histStates.length-1;
  const canBack=effectiveIdx>0&&(puzzleStatus==='solved'||!puzzleMode);
  const canFwd=effectiveIdx<histStates.length-1&&(puzzleStatus==='solved'||!puzzleMode);
  const isLive=viewIdx===null;
  const goBack=()=>setViewIdx(effectiveIdx-1);
  const goFwd=()=>{const next=effectiveIdx+1;if(next>=histStates.length-1)setViewIdx(null);else setViewIdx(next);};
  const activeHistIdx=effectiveIdx-1;
  const moveListRef=useRef(null);

  // Keyboard ← → navigation through the move history (ignored while typing or exploring a PV)
  useEffect(()=>{
    const onKey=(e)=>{
      if(e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
      if(pvExploreIdx!==null||promo)return;
      if(e.key==='ArrowLeft'&&canBack){e.preventDefault();setViewIdx(effectiveIdx-1);}
      else if(e.key==='ArrowRight'&&canFwd){e.preventDefault();const n=effectiveIdx+1;setViewIdx(n>=histStates.length-1?null:n);}
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[canBack,canFwd,effectiveIdx,histStates.length,pvExploreIdx,promo]);

  // Auto-scroll the move list so the active (or latest) move stays in view.
  // Scrolls only the list container — never the page — to avoid jumping on mobile.
  useEffect(()=>{
    const c=moveListRef.current;if(!c)return;
    const ply=isLive?sanList.length-1:activeHistIdx;
    if(ply<0)return;
    const el=c.querySelector(`[data-ply="${ply}"]`);
    if(!el)return;
    const cr=c.getBoundingClientRect(),er=el.getBoundingClientRect();
    c.scrollTop+=(er.top-cr.top)-(c.clientHeight/2-el.clientHeight/2);
  },[viewIdx,sanList.length,isLive,activeHistIdx,reviewMode,puzzleMode]);

  // Display state (PV explore > historical view > live)
  const pvState=pvExploreIdx!==null&&pvExploreStates?pvExploreStates[pvExploreIdx]:null;
  const viewState=viewIdx!==null?histStates[viewIdx]:null;
  const displayBoard=pvState?pvState.board:(viewState?viewState.board:board);
  const displayLast=pvState?pvState.last:(viewState?viewState.last:last);
  const displayCapW=viewState?viewState.capW:capW;
  const displayCapB=viewState?viewState.capB:capB;
  const displayMatAdv=(()=>{let wL=0,bL=0;displayCapW.forEach(p=>wL+=mv(p));displayCapB.forEach(p=>bL+=mv(p));return bL-wL})();

  const renderKingAvatar=(color,size)=>{
    const bg=color==='w'?'#3a3028':'#d4c49a';
    const border=`2px solid ${color==='w'?'#6a5a4a':'#a89060'}`;
    const imgSz=Math.round(size*0.7);
    return <div style={{width:size,height:size,borderRadius:size>40?8:6,background:bg,border,display:'flex',alignItems:'center',justifyContent:'center'}}><img src={PIECE_SVG[color==='w'?WK:BK]} alt="" style={{width:imgSz,height:imgSz}}/></div>;
  };

  // Emoji avatar for an AI bot (chess.com-style character)
  const renderBotAvatar=(bot,size)=>(
    <div style={{width:size,height:size,borderRadius:size>40?10:8,background:`${bot.color}22`,
      border:`2px solid ${bot.color}`,display:'flex',alignItems:'center',justifyContent:'center',
      lineHeight:1,flexShrink:0}}>
      <span style={{fontSize:Math.round(size*0.58)}}>{bot.avatar}</span>
    </div>
  );

  const renderCap=(pieces,order,adv)=>{
    const g={};order.forEach(p=>g[p]=0);pieces.forEach(p=>g[p]=(g[p]||0)+1);
    return(<div style={{display:'flex',alignItems:'center',gap:1,minHeight:26,flexWrap:'wrap'}}>
      {order.map(p=>{if(!g[p])return null;return Array.from({length:g[p]}).map((_,i)=>(
        <img key={`${p}-${i}`} src={PIECE_SVG[p]} alt="" draggable={false}
          style={{width:20,height:20,marginRight:i===g[p]-1?3:-3,
          filter:'drop-shadow(0 1px 1px rgba(0,0,0,0.4))'}}/>))})}
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
      sq.push(<div key={idx} onClick={()=>click(idx)} className="board-square"
        style={{width:'12.5%',height:'12.5%',backgroundColor:bg,display:'flex',alignItems:'center',justifyContent:'center',position:'relative',cursor:(isLive&&turn===pc&&!over)||(puzzleMode&&puzzleStatus==='playing'&&turn===pc)?'pointer':'default',transition:'background-color 0.15s',userSelect:'none'}}>
        {isLeg&&!piece&&<div style={{width:'26%',height:'26%',borderRadius:'50%',backgroundColor:'rgba(0,0,0,0.18)'}}/>}
        {isLeg&&!!piece&&<div style={{position:'absolute',inset:0,border:'4px solid rgba(0,0,0,0.25)',borderRadius:'50%',boxSizing:'border-box'}}/>}
        {!!piece&&<img className="chess-piece" src={PIECE_SVG[piece]} alt="" draggable={false}
          style={{width:'85%',height:'85%',zIndex:1,filter:'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',pointerEvents:'none'}}/>}
        {ci===0&&<span style={{position:'absolute',top:2,left:3,fontSize:12,fontWeight:700,color:lt?'#b58863':'#e8d5b5',opacity:0.8}}>{RL[flip?7-ri:ri]}</span>}
        {ri===7&&<span style={{position:'absolute',bottom:1,right:3,fontSize:12,fontWeight:700,color:lt?'#b58863':'#e8d5b5',opacity:0.8}}>{FL[flip?7-ci:ci]}</span>}
      </div>);}
    return sq;
  };

  const topCapDisp=pc==='w'?displayCapB:displayCapW, botCapDisp=pc==='w'?displayCapW:displayCapB;
  const topOrd=pc==='w'?B_ORD:W_ORD, botOrd=pc==='w'?W_ORD:B_ORD;
  const topAdv=pc==='w'?(displayMatAdv>0?displayMatAdv:0):(displayMatAdv<0?-displayMatAdv:0);
  const botAdv=pc==='w'?(displayMatAdv<0?-displayMatAdv:0):(displayMatAdv>0?displayMatAdv:0);
  
  // Find nearest difficulty setting for visual styles and search params
  const d=DIFFS.reduce((prev,curr)=>Math.abs(curr.elo-elo)<Math.abs(prev.elo-elo)?curr:prev);

  return(
    <div className="app-container" style={{height:'100vh',background:'#262421',display:'flex',flexDirection:'column',fontFamily:"'DM Sans',sans-serif",color:'#e8e0d5'}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Mono:wght@700&display=swap" rel="stylesheet"/>

      {/* ── Top bar ── */}
      <div className="top-bar">
        <div className="top-title">
          <span style={{fontFamily:"'Space Mono',monospace",fontWeight:700,color:'#e8d5b5',fontSize:17}}>♚ Chess Arena</span>
          <span className="hide-on-mobile" style={{fontSize:11,color:'#e8a040'}}>Enhanced Engine</span>
        </div>
        
        <div className="top-buttons">
          <button onClick={swap}
            style={{padding:'7px 12px',background:'rgba(255,255,255,0.08)',color:'#ccc',border:'1px solid rgba(255,255,255,0.14)',borderRadius:7,fontWeight:700,fontSize:13,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",whiteSpace:'nowrap'}}>
            {pc==='w'?'♔ White':'♚ Black'} <span className="hide-on-mobile">⇄</span>
          </button>
          <button onClick={()=>reset()}
            style={{padding:'7px 12px',background:'rgba(255,255,255,0.08)',color:'#ccc',border:'1px solid rgba(255,255,255,0.14)',borderRadius:7,fontWeight:700,fontSize:13,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",whiteSpace:'nowrap'}}>
            <span className="hide-on-mobile">↺ </span>New<span className="hide-on-mobile"> Game</span>
          </button>
          <button onClick={()=>setSoundOn(!soundOn)}
            style={{padding:'7px 12px',background:soundOn?'rgba(60,220,130,0.15)':'rgba(255,255,255,0.08)',color:soundOn?'#3cdc82':'#888',border:`1px solid ${soundOn?'rgba(60,220,130,0.4)':'rgba(255,255,255,0.14)'}`,borderRadius:7,fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.2s'}}>
            {soundOn?'🔊':'🔇'}
          </button>
          <button onClick={puzzleMode?exitPuzzleMode:enterPuzzleMode}
            style={{padding:'7px 12px',background:puzzleMode?'rgba(137,212,240,0.2)':'rgba(255,255,255,0.08)',color:puzzleMode?'#89d4f0':'#ccc',border:`1px solid ${puzzleMode?'rgba(137,212,240,0.5)':'rgba(255,255,255,0.14)'}`,borderRadius:7,fontWeight:700,fontSize:13,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",whiteSpace:'nowrap',transition:'all 0.2s',boxShadow:puzzleMode?'0 0 8px rgba(137,212,240,0.2)':'none'}}>
            {puzzleMode?'게임 복귀':'🧩 퍼즐'}
          </button>
        </div>
        
        <div className="elo-controls" style={{display:'flex',alignItems:'center',gap:8,marginLeft:'auto'}}>
          <span className="hide-on-mobile" style={{fontSize:12,color:'#666'}}>상대</span>
          <button onClick={()=>setShowBotPicker(true)} title="상대 선택"
            style={{display:'flex',alignItems:'center',gap:8,padding:'5px 10px',background:'rgba(255,255,255,0.08)',
              color:'#e8e0d5',border:`1px solid ${selectedBot.color}66`,borderRadius:8,cursor:'pointer',
              fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:13,whiteSpace:'nowrap'}}>
            <span style={{fontSize:18,lineHeight:1}}>{selectedBot.avatar}</span>
            <span className="hide-on-mobile">{selectedBot.name}</span>
            <span style={{color:selectedBot.color,fontFamily:"'Space Mono',monospace"}}>ELO {elo}</span>
            <span style={{fontSize:10,color:'#8a8580'}}>▾</span>
          </button>
        </div>
      </div>

      {/* ── Main layout ── */}
      <div className="main-layout" style={{flex:1,display:'flex',minHeight:0}}>

        {/* ── Board section ── */}
        <div className="board-section" style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'10px 20px'}}>

          {/* Opponent row — click to open the character gallery */}
          <div className="player-row top" style={{marginBottom:10,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div onClick={()=>setShowBotPicker(true)} title="상대 선택"
              style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',borderRadius:8,padding:'2px 4px',transition:'background 0.15s'}}
              onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.06)'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              {selectedBot.id==='custom'?renderKingAvatar(ac,46):renderBotAvatar(selectedBot,46)}
              <div>
                <div style={{fontSize:16,fontWeight:700,color:'#e8e0d5',display:'flex',alignItems:'center',gap:6}}>{selectedBot.name}<span style={{fontSize:11,color:'#8a8580'}}>▾</span></div>
                <div style={{fontSize:12,color:'#8a8580'}}>ELO {elo} · {selectedBot.title}</div>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center'}}>{renderCap(topCapDisp,topOrd,topAdv)}</div>
          </div>

          {/* Eval bar + Board */}
          <div style={{display:'flex',alignItems:'stretch',width:'100%',justifyContent:'center'}}>
            {/* Eval bar */}
            <div className="eval-bar" style={{width:42,borderRadius:'5px 0 0 5px',overflow:'hidden',background:flip?'#e8e0d0':'#1a1816',position:'relative',flexShrink:0}}>
              <div style={{position:'absolute',bottom:0,left:0,right:0,height:`${flip?100-evalPct:evalPct}%`,background:flip?'#1a1816':'#e8e0d0',transition:'height 0.25s ease'}}/>
              <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%) rotate(-90deg)',fontSize:12,fontWeight:700,color:'#e8e0d5',whiteSpace:'nowrap',fontFamily:"'Space Mono',monospace",textShadow:'0 0 6px #000,0 0 12px #000'}}>{evalText}</div>
            </div>

            {/* Board */}
            <div className="chess-board" style={{display:'flex',flexWrap:'wrap',borderRadius:'0 5px 5px 0',overflow:'hidden',boxShadow:'0 10px 50px rgba(0,0,0,0.7)',position:'relative'}}>
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

              {/* 복기 중 최선의 수 화살표 (파란색) */}
              {viewIdx!==null&&viewIdx>0&&bestMoves[viewIdx-1]&&moveClassifications[viewIdx-1]?.grade!=='best'&&(()=>{
                const bm=bestMoves[viewIdx-1];
                const sc=(i)=>{const r=i>>3,c=i&7;return[(flip?7-c:c)*12.5+6.25,(flip?7-r:r)*12.5+6.25];};
                const[x1,y1]=sc(bm.f);const[x2,y2]=sc(bm.t);
                const dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy);
                const ex=x2-dx/len*4,ey=y2-dy/len*4;
                return(<svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:5}} viewBox="0 0 100 100">
                  <defs><marker id="bma" markerWidth="3" markerHeight="3" refX="1.5" refY="1.5" orient="auto">
                    <polygon points="0 0,3 1.5,0 3" fill="rgba(100,180,255,0.88)"/></marker></defs>
                  <circle cx={x1} cy={y1} r="4" fill="rgba(100,180,255,0.2)" stroke="rgba(100,180,255,0.7)" strokeWidth="0.8"/>
                  <line x1={x1} y1={y1} x2={ex} y2={ey} stroke="rgba(100,180,255,0.82)" strokeWidth="1.8" markerEnd="url(#bma)" strokeLinecap="round"/>
                </svg>);
              })()}

              {promo&&(
                <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.78)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:10}}>
                  <div style={{background:'#2c2a28',borderRadius:12,padding:'20px 16px',display:'flex',gap:12,boxShadow:'0 6px 28px rgba(0,0,0,0.7)'}}>
                    {promo.mvs.map((m,i)=>(
                      <button key={i} onClick={()=>doPromo(m)}
                        style={{width:70,height:70,background:'rgba(255,255,255,0.08)',border:'2px solid rgba(255,255,255,0.18)',borderRadius:10,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <img src={PIECE_SVG[m.pr]} alt="" draggable={false} style={{width:50,height:50}}/></button>))}
                  </div>
                </div>)}
            </div>
          </div>

          {/* Player row */}
          <div className="player-row" style={{marginTop:10,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              {renderKingAvatar(pc,46)}
              <div>
                <div style={{fontSize:16,fontWeight:700,color:'#e8e0d5'}}>You</div>
                <div style={{fontSize:12,color:'#8a8580'}}>{pc==='w'?'White':'Black'}</div>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center'}}>{renderCap(botCapDisp,botOrd,botAdv)}</div>
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="right-panel">

          {/* Panel header */}
          <div style={{padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.05)',background:'linear-gradient(to bottom, rgba(255,255,255,0.03), transparent)',display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
            <span style={{fontSize:20,filter:'drop-shadow(0 0 5px rgba(240,192,64,0.5))'}}>📊</span>
            <span style={{fontSize:17,fontWeight:700,color:'#e8e0d5',fontFamily:"'Space Mono',monospace",letterSpacing:1}}>분석 리포트</span>
            <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}>
              {!thinking&&<button onClick={handleImportPGN} style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'#b0a898',fontSize:10,padding:'4px 6px',borderRadius:4,cursor:'pointer',fontWeight:700,transition:'all 0.2s'}}>📥 불러오기</button>}
              {histStates.length>1&&<button onClick={handleExportPGN} style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'#b0a898',fontSize:10,padding:'4px 6px',borderRadius:4,cursor:'pointer',fontWeight:700,transition:'all 0.2s'}}>📋 내보내기</button>}
              {viewIdx!==null&&pvExploreIdx===null&&<span style={{fontSize:10,fontWeight:800,color:'#111',background:'#f0c040',padding:'3px 8px',borderRadius:4,boxShadow:'0 0 10px rgba(240,192,64,0.4)',marginLeft:4}}>REVIEW</span>}
              {pvExploreIdx!==null&&<span style={{fontSize:10,fontWeight:800,color:'#111',background:'#3cdc82',padding:'3px 8px',borderRadius:4,boxShadow:'0 0 10px rgba(60,220,130,0.4)',marginLeft:4}}>PV 탐색</span>}
              {puzzleMode&&<span style={{fontSize:10,fontWeight:800,color:'#111',background:'#89d4f0',padding:'3px 8px',borderRadius:4,boxShadow:'0 0 10px rgba(137,212,240,0.4)',marginLeft:4}}>PUZZLE</span>}
            </div>
          </div>

          {/* ── Controls section (always visible) ── */}
          <div style={{padding:'14px 20px',borderBottom:'1px solid rgba(255,255,255,0.05)',flexShrink:0}}>
            {/* Status */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:34,marginBottom:12}}>
              {over&&!puzzleMode?(
                <div style={{display:'flex',alignItems:'center',gap:10,background:'rgba(232,213,181,0.1)',border:'1px solid rgba(232,213,181,0.3)',borderRadius:8,padding:'8px 16px',boxShadow:'0 0 15px rgba(232,213,181,0.1)'}}>
                  <span style={{color:'#e8d5b5',fontWeight:700,fontFamily:"'Space Mono',monospace",fontSize:15}}>{over}</span>
                  <button onClick={()=>reset()} style={{padding:'6px 14px',background:'#e8d5b5',color:'#111',border:'none',borderRadius:6,fontWeight:800,fontSize:13,cursor:'pointer',boxShadow:'0 2px 8px rgba(0,0,0,0.3)'}}>Play Again</button>
                </div>
              ):thinking?(
                <><span style={{display:'inline-block',width:14,height:14,borderRadius:'50%',border:'2px solid #f0c040',borderTopColor:'transparent',animation:'spin 0.8s linear infinite'}}/></>
              ):chk?(
                <span style={{color:'#e05050',fontWeight:800,fontSize:16,textShadow:'0 0 10px rgba(224,80,80,0.5)',letterSpacing:1}}>CHECK!</span>
              ):(
                <span style={{color:'#8a8580',fontSize:14,fontWeight:600}}>{turn==='w'?'White':'Black'} to move</span>
              )}
            </div>

            {/* Move grade badge when reviewing */}
            {viewIdx!==null&&viewIdx>0&&moveClassifications[viewIdx-1]&&(()=>{
              const mc=moveClassifications[viewIdx-1];
              const gi=GRADE_INFO[mc.grade];
              return(
                <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',background:gi.color+'22',border:`1.5px solid ${gi.color}88`,borderRadius:10,marginBottom:12,flexWrap:'wrap',boxShadow:`0 4px 20px ${gi.color}15, inset 0 0 10px ${gi.color}10`, minHeight: '74px', boxSizing: 'border-box', alignContent: 'flex-start'}}>
                  <span style={{fontSize:20,filter:`drop-shadow(0 0 4px ${gi.color}88)`}}>{gi.sym}</span>
                  <span style={{fontSize:16,fontWeight:800,color:gi.color,fontFamily:"'Space Mono',monospace",textShadow:`0 0 8px ${gi.color}44`}}>{gi.label}</span>
                  <span style={{fontSize:13,color:'#e8e0d5',marginLeft:6,fontWeight:600}}>{mc.player==='w'?'백':'흑'} · -{(mc.cpLoss/100).toFixed(1)}점</span>
                  {mc.grade!=='best'&&bestMoves[viewIdx-1]&&(()=>{
                    const bm=bestMoves[viewIdx-1];
                    return(<>
                      <div style={{width:'100%',marginTop:6,fontSize:12,color:'#89d4f0',fontFamily:"'Space Mono',monospace",fontWeight:700,paddingLeft:30,textShadow:'0 0 5px rgba(137,212,240,0.3)'}}>최선: {FL[bm.f&7]}{RL[bm.f>>3]} → {FL[bm.t&7]}{RL[bm.t>>3]}</div>
                      {bm.pv&&bm.pv.length>1&&pvExploreIdx===null&&(
                        <div style={{width:'100%',marginTop:4,fontSize:11,color:'#666',fontFamily:"'Space Mono',monospace",paddingLeft:30,lineHeight:1.6}}>
                          <span style={{color:'#555',marginRight:4}}>계속수</span>
                          {bm.pv.slice(1).map((mv,i)=>(
                            <span key={i} style={{color:i%2===0?'#89d4f088':'#e8d5b566',marginRight:5}}>{FL[mv.f&7]}{RL[mv.f>>3]}→{FL[mv.t&7]}{RL[mv.t>>3]}</span>
                          ))}
                        </div>
                      )}
                      {bm.pv&&bm.pv.length>0&&pvExploreIdx===null&&(
                        <button onClick={()=>{
                          const origin=histStates[viewIdx-1];
                          enterPVExplore(origin.board,origin.turn,origin.ep,origin.cas,origin.last,bm.pv);
                        }} style={{width:'100%',marginTop:6,padding:'6px 10px',background:'rgba(137,212,240,0.12)',color:'#89d4f0',border:'1px solid rgba(137,212,240,0.35)',borderRadius:7,fontSize:12,cursor:'pointer',fontWeight:700,fontFamily:"'Space Mono',monospace",textAlign:'left'}}>
                          🔍 최선수부터 탐색 ({bm.pv.length}수)
                        </button>
                      )}
                    </>);
                  })()}
                </div>
              );
            })()}

            {/* Navigation */}
            <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
              <button onClick={()=>setViewIdx(0)} disabled={!canBack||pvExploreIdx!==null}
                style={{padding:'8px 12px',background:(canBack&&pvExploreIdx===null)?'rgba(255,255,255,0.08)':'rgba(255,255,255,0.03)',color:(canBack&&pvExploreIdx===null)?'#e8d5b5':'#444',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:16,cursor:(canBack&&pvExploreIdx===null)?'pointer':'default',transition:'all 0.2s',boxShadow:(canBack&&pvExploreIdx===null)?'0 2px 5px rgba(0,0,0,0.3)':'none'}}>⏮</button>
              <button onClick={goBack} disabled={!canBack||pvExploreIdx!==null}
                style={{padding:'8px 16px',background:(canBack&&pvExploreIdx===null)?'rgba(255,255,255,0.08)':'rgba(255,255,255,0.03)',color:(canBack&&pvExploreIdx===null)?'#e8d5b5':'#444',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:20,cursor:(canBack&&pvExploreIdx===null)?'pointer':'default',transition:'all 0.2s',boxShadow:(canBack&&pvExploreIdx===null)?'0 2px 5px rgba(0,0,0,0.3)':'none'}}>‹</button>
              <button onClick={goFwd} disabled={!canFwd||pvExploreIdx!==null}
                style={{padding:'8px 16px',background:(canFwd&&pvExploreIdx===null)?'rgba(255,255,255,0.08)':'rgba(255,255,255,0.03)',color:(canFwd&&pvExploreIdx===null)?'#e8d5b5':'#444',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:20,cursor:(canFwd&&pvExploreIdx===null)?'pointer':'default',transition:'all 0.2s',boxShadow:(canFwd&&pvExploreIdx===null)?'0 2px 5px rgba(0,0,0,0.3)':'none'}}>›</button>
              <button onClick={()=>setViewIdx(null)} disabled={isLive||pvExploreIdx!==null}
                style={{padding:'8px 12px',background:(!isLive&&pvExploreIdx===null)?'rgba(255,255,255,0.08)':'rgba(255,255,255,0.03)',color:(!isLive&&pvExploreIdx===null)?'#e8d5b5':'#444',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:16,cursor:(!isLive&&pvExploreIdx===null)?'pointer':'default',transition:'all 0.2s',boxShadow:(!isLive&&pvExploreIdx===null)?'0 2px 5px rgba(0,0,0,0.3)':'none'}}>⏭</button>
              
              <div style={{width:1,height:24,background:'rgba(255,255,255,0.1)',margin:'0 4px'}}/>
              
              {!puzzleMode&&(()=>{const canUndo=!thinking&&histStates.length>=3&&isLive;return(
                <button onClick={handleUndo} disabled={!canUndo}
                  style={{padding:'8px 14px',background:canUndo?'rgba(255,255,255,0.08)':'rgba(255,255,255,0.03)',color:canUndo?'#e8d5b5':'#444',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:13,cursor:canUndo?'pointer':'default',fontWeight:700,transition:'all 0.2s'}}>↩ 무르기</button>
              );})()}
              {!puzzleMode&&(()=>{const canHint=!thinking&&!over&&isLive;const active=!!hintMove;return(
                <button onClick={handleHint} disabled={!canHint&&!active}
                  style={{padding:'8px 14px',background:active?'rgba(60,220,130,0.15)':'rgba(255,255,255,0.08)',color:!canHint&&!active?'#444':active?'#3cdc82':'#e8d5b5',border:`1px solid ${active?'rgba(60,220,130,0.5)':'rgba(255,255,255,0.1)'}`,borderRadius:8,fontSize:13,cursor:(canHint||active)?'pointer':'default',fontWeight:700,display:'flex',alignItems:'center',gap:6,transition:'all 0.2s',boxShadow:active?'0 0 10px rgba(60,220,130,0.2)':'none'}}>
                  {hintThinking?<span style={{display:'inline-block',width:10,height:10,borderRadius:'50%',border:'2px solid #3cdc82',borderTopColor:'transparent',animation:'spin 0.8s linear infinite'}}/>:'💡'}
                  {active?'끄기':'힌트'}
                </button>
              );})()}
              {!puzzleMode&&(()=>{const canSurr=!over&&!thinking&&isLive&&hist.length>0;return(
                <button onClick={handleSurrender} disabled={!canSurr}
                  style={{padding:'8px 14px',background:canSurr?'rgba(224,80,80,0.15)':'rgba(255,255,255,0.03)',color:canSurr?'#e05050':'#444',border:`1px solid ${canSurr?'rgba(224,80,80,0.4)':'rgba(255,255,255,0.1)'}`,borderRadius:8,fontSize:13,cursor:canSurr?'pointer':'default',fontWeight:700,transition:'all 0.2s'}}>
                  🏳 항복
                </button>
              );})()}
            </div>
            {searchInfo&&<div style={{fontSize:11,color:'#666',marginTop:8,fontFamily:"'Space Mono',monospace",textAlign:'right'}}>{searchInfo}</div>}
            {pvExploreIdx!==null&&pvExploreStates&&(
              <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 0',flexWrap:'wrap'}}>
                <button onClick={()=>setPvExploreIdx(i=>Math.max(0,i-1))} disabled={pvExploreIdx<=0}
                  style={{padding:'5px 10px',background:'rgba(255,255,255,0.07)',color:pvExploreIdx<=0?'#444':'#e8e0d5',border:'1px solid rgba(255,255,255,0.15)',borderRadius:6,fontSize:16,cursor:pvExploreIdx<=0?'default':'pointer',fontWeight:700}}>‹</button>
                <span style={{fontSize:12,color:'#8a8580',fontFamily:"'Space Mono',monospace",fontWeight:700,minWidth:50,textAlign:'center'}}>{pvExploreIdx}/{pvExploreStates.length-1}수</span>
                <button onClick={()=>setPvExploreIdx(i=>Math.min(pvExploreStates.length-1,i+1))} disabled={pvExploreIdx>=pvExploreStates.length-1}
                  style={{padding:'5px 10px',background:'rgba(255,255,255,0.07)',color:pvExploreIdx>=pvExploreStates.length-1?'#444':'#e8e0d5',border:'1px solid rgba(255,255,255,0.15)',borderRadius:6,fontSize:16,cursor:pvExploreIdx>=pvExploreStates.length-1?'default':'pointer',fontWeight:700}}>›</button>
                <button onClick={exitPVExplore}
                  style={{marginLeft:'auto',padding:'5px 10px',background:'rgba(224,80,80,0.1)',color:'#e05050',border:'1px solid rgba(224,80,80,0.35)',borderRadius:6,fontSize:12,cursor:'pointer',fontWeight:700}}>✕ 종료</button>
              </div>
            )}
            {hintMove&&(
              <div style={{marginTop:8}}>
                {pvExploreIdx===null&&!hintThinking&&hintMove.pv?.length>0&&(
                  <button onClick={()=>enterPVExplore(board,turn,ep,cas,last,hintMove.pv)}
                    style={{width:'100%',padding:'7px 12px',background:'rgba(60,220,130,0.12)',color:'#3cdc82',border:'1px solid rgba(60,220,130,0.35)',borderRadius:8,fontSize:12,cursor:'pointer',fontWeight:700,fontFamily:"'Space Mono',monospace",textAlign:'left'}}>
                    🔍 계속수 탐색 ({hintMove.pv.length}수)
                  </button>
                )}
                {pvExploreIdx===null&&hintMove.pv?.length>1&&(
                  <div style={{marginTop:6,padding:'8px 12px',background:'rgba(60,220,130,0.06)',border:'1px solid rgba(60,220,130,0.2)',borderRadius:8,fontSize:11,fontFamily:"'Space Mono',monospace"}}>
                    <span style={{color:'#3cdc82',marginRight:6,fontWeight:700}}>계속수</span>
                    {hintMove.pv.slice(1).map((mv,i)=>(
                      <span key={i} style={{color:i%2===0?'#89d4f088':'#e8d5b566',marginRight:5}}>{FL[mv.f&7]}{RL[mv.f>>3]}→{FL[mv.t&7]}{RL[mv.t>>3]}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Scrollable content */}
          <div style={{flex:1,overflowY:'auto',overflowX:'hidden'}}>
            {puzzleMode?(
              <div style={{padding:'18px'}}>
                {!puzzleData?(
                  <div style={{textAlign:'center',color:'#666',fontSize:14}}>퍼즐 불러오는 중...</div>
                ):(
                  <>
                    {/* Header */}
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                      <span style={{fontSize:20}}>🧩</span>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:700,fontSize:15,color:'#e8e0d5'}}>퍼즐</div>
                        <div style={{fontSize:12,color:'#8a8580',fontFamily:"'Space Mono',monospace"}}>Rating {puzzleData.rating}</div>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:6,padding:'5px 10px',borderRadius:6,background:pc==='w'?'rgba(220,212,200,0.12)':'rgba(40,36,32,0.6)',border:`1px solid ${pc==='w'?'rgba(220,212,200,0.3)':'rgba(255,255,255,0.15)'}`}}>
                        <span style={{fontSize:14}}>{pc==='w'?'♔':'♚'}</span>
                        <span style={{fontSize:12,fontWeight:700,color:pc==='w'?'#e8e0d5':'#b0a898'}}>당신은 {pc==='w'?'백':'흑'}</span>
                      </div>
                    </div>
                    {/* Themes */}
                    <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:14}}>
                      {puzzleData.themes.slice(0,5).map(t=>(
                        <span key={t} style={{fontSize:11,color:'#89d4f0',background:'rgba(137,212,240,0.1)',border:'1px solid rgba(137,212,240,0.25)',borderRadius:4,padding:'2px 6px',fontWeight:600}}>{t}</span>
                      ))}
                    </div>
                    {puzzleAnalysisMode?(
                      /* ── Puzzle Analysis Panel ── */
                      <>
                        {/* Eval graph */}
                        <div style={{marginBottom:12,borderRadius:7,overflow:'hidden',border:'1px solid rgba(255,255,255,0.12)'}}>
                          {renderEvalGraph()}
                        </div>
                        {/* Move list */}
                        <div style={{marginBottom:12,maxHeight:200,overflowY:'auto'}}>
                          {histStates.slice(1).map((s,i)=>{
                            const mv=s.last;
                            if(!mv)return null;
                            const mover=histStates[i].turn;
                            const isPlayer=mover===pc;
                            const grade=moveClassifications[i];
                            const gi=grade?GRADE_INFO[grade.grade]:null;
                            const isActive=viewIdx===i+1;
                            const notation=`${FL[mv.f&7]}${RL[mv.f>>3]}→${FL[mv.t&7]}${RL[mv.t>>3]}`;
                            return(
                              <div key={i} onClick={()=>setViewIdx(i+1)}
                                style={{display:'flex',alignItems:'center',gap:6,padding:'5px 8px',borderRadius:5,marginBottom:2,
                                  cursor:'pointer',
                                  background:isActive?'rgba(255,255,255,0.10)':'rgba(255,255,255,0.03)',
                                  border:`1px solid ${isActive?'rgba(255,255,255,0.22)':'transparent'}`,
                                  transition:'background 0.15s'}}>
                                <span style={{fontSize:11,color:'#555',minWidth:18,fontFamily:"'Space Mono',monospace"}}>{i+1}</span>
                                <span style={{fontSize:12,color:isPlayer?'#e8e0d5':'#8a8580',fontFamily:"'Space Mono',monospace",flex:1}}>{notation}</span>
                                <span style={{fontSize:11,color:'#666'}}>{isPlayer?`${pc==='w'?'♔':'♚'} 당신`:`${pc==='w'?'♚':'♔'} 상대`}</span>
                                {isPlayer&&gi&&(
                                  <span style={{fontSize:11,fontWeight:700,color:gi.color,padding:'1px 5px',borderRadius:3,background:`${gi.color}18`,border:`1px solid ${gi.color}44`}}>
                                    {gi.sym} {gi.label}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {/* 결정적 순간 — worst player move */}
                        {(()=>{
                          const myMoves=moveClassifications.map((m,i)=>({...m,idx:i})).filter(m=>m.player===pc);
                          const worst=myMoves.length?[...myMoves].sort((a,b)=>b.cpLoss-a.cpLoss)[0]:null;
                          if(!worst||worst.cpLoss<150)return null;
                          const bm=bestMoves[worst.idx];
                          const gi=GRADE_INFO[worst.grade];
                          return(
                            <div style={{marginBottom:10,padding:'8px 12px',borderRadius:7,background:`${gi.color}15`,border:`1px solid ${gi.color}44`,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                              <span style={{fontSize:14}}>{gi.sym}</span>
                              <span style={{fontSize:12,fontWeight:700,color:gi.color}}>결정적 순간: {worst.idx+1}번째 수</span>
                              {bm&&<span style={{fontSize:11,color:'#89d4f0',fontFamily:"'Space Mono',monospace"}}>최선 {FL[bm.f&7]}{RL[bm.f>>3]}→{FL[bm.t&7]}{RL[bm.t>>3]}</span>}
                              <button onClick={()=>setViewIdx(worst.idx+1)} style={{marginLeft:'auto',padding:'3px 8px',background:'rgba(255,255,255,0.08)',color:'#e8e0d5',border:'1px solid rgba(255,255,255,0.15)',borderRadius:5,fontSize:11,cursor:'pointer',fontWeight:700}}>이 수 보기</button>
                            </div>
                          );
                        })()}
                        {/* Current position insight */}
                        {viewIdx!==null&&viewIdx>0&&(()=>{
                          const cls=moveClassifications[viewIdx-1];
                          const bm=bestMoves[viewIdx-1];
                          const mover=histStates[viewIdx-1]?.turn;
                          const isPlayer=mover===pc;
                          if(!cls)return null;
                          const gi=GRADE_INFO[cls.grade];
                          const bmNotation=bm?`${FL[bm.f&7]}${RL[bm.f>>3]}→${FL[bm.t&7]}${RL[bm.t>>3]}`:null;
                          const playedMv=histStates[viewIdx]?.last;
                          const playedNotation=playedMv?`${FL[playedMv.f&7]}${RL[playedMv.f>>3]}→${FL[playedMv.t&7]}${RL[playedMv.t>>3]}`:'';
                          return(
                            <div style={{marginBottom:10,padding:'9px 12px',borderRadius:7,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.10)'}}>
                              {isPlayer?(
                                <>
                                  <div style={{fontSize:12,fontWeight:700,color:gi.color,marginBottom:4}}>
                                    {gi.sym} {gi.label} — 당신의 수: {playedNotation}
                                  </div>
                                  {bm&&cls.grade!=='best'&&(
                                    <div style={{fontSize:11,color:'#8a8580'}}>
                                      최선: <span style={{color:'#89d4f0',fontFamily:"'Space Mono',monospace"}}>{bmNotation}</span>
                                      {cls.cpLoss>0&&<span style={{color:'#888'}}> ({cls.cpLoss>0?'-':''}{(cls.cpLoss/100).toFixed(1)}점 손실)</span>}
                                    </div>
                                  )}
                                  {bm&&bm.pv&&bm.pv.length>0&&(
                                    <div style={{fontSize:11,color:'#555',marginTop:3}}>
                                      예상: {bm.pv.slice(0,4).map(m=>`${FL[m.f&7]}${RL[m.f>>3]}${FL[m.t&7]}${RL[m.t>>3]}`).join(' ')}
                                    </div>
                                  )}
                                </>
                              ):(
                                <div style={{fontSize:12,color:'#8a8580'}}>
                                  🤖 상대 강제 응수: <span style={{color:'#e8e0d5',fontFamily:"'Space Mono',monospace"}}>{playedNotation}</span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {/* Analysis buttons */}
                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                          <button onClick={()=>{setPuzzleAnalysisMode(false);setViewIdx(null);}}
                            style={{padding:'7px 12px',background:'rgba(255,255,255,0.06)',color:'#b0a898',border:'1px solid rgba(255,255,255,0.14)',borderRadius:7,fontSize:12,cursor:'pointer',fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
                            ✕ 분석 종료
                          </button>
                          <button onClick={enterPuzzleMode}
                            style={{padding:'7px 12px',background:'rgba(137,212,240,0.15)',color:'#89d4f0',border:'1px solid rgba(137,212,240,0.4)',borderRadius:7,fontSize:12,cursor:'pointer',fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
                            다음 퍼즐 →
                          </button>
                        </div>
                      </>
                    ):(
                      /* ── Normal puzzle play UI ── */
                      <>
                        {/* Status */}
                        <div style={{fontSize:14,fontWeight:700,marginBottom:14,padding:'10px 14px',borderRadius:8,
                          background:puzzleStatus==='solved'?'rgba(126,207,126,0.12)':puzzleStatus==='fail'?'rgba(224,80,80,0.12)':'rgba(255,255,255,0.04)',
                          border:`1px solid ${puzzleStatus==='solved'?'rgba(126,207,126,0.35)':puzzleStatus==='fail'?'rgba(224,80,80,0.35)':'rgba(255,255,255,0.08)'}`,
                          color:puzzleStatus==='solved'?'#7ecf7e':puzzleStatus==='fail'?'#e05050':'#e8e0d5',
                          transition:'all 0.3s'}}>
                          <div>{puzzleStatus==='solved'?'✓ 정답!':
                           puzzleStatus==='fail'?'✗ 틀렸습니다 — 다시 시도':
                           puzzleMoveIdx%2===1?'⏳ 상대 수 분석 중...':'최선의 수를 찾으세요!'}</div>
                          {puzzleStatus==='solved'&&(()=>{
                            if(puzzleSolvedEval===null)return(<div style={{fontSize:11,fontWeight:500,color:'#7ecf7e99',marginTop:6,fontFamily:"'Space Mono',monospace"}}>최종 평가 분석 중…</div>);
                            const abs=Math.abs(puzzleSolvedEval);
                            const isMate=abs>=90000;
                            const sign=puzzleSolvedEval>=0?'+':'';
                            const display=isMate?(puzzleSolvedEval>0?'+M':'-M'):(sign+(puzzleSolvedEval/100).toFixed(1));
                            const verdict=isMate?(puzzleSolvedEval>0?'외통수!':'상대 외통수'):
                                           puzzleSolvedEval>=300?'크게 유리':
                                           puzzleSolvedEval>=150?'유리':
                                           puzzleSolvedEval>=50?'약간 유리':
                                           puzzleSolvedEval>=-50?'호각':
                                           puzzleSolvedEval>=-150?'약간 불리':'불리';
                            const color=puzzleSolvedEval>=150?'#7ecf7e':puzzleSolvedEval>=-50?'#e8d090':'#e0a070';
                            return(
                              <div style={{fontSize:12,fontWeight:600,marginTop:8,fontFamily:"'Space Mono',monospace",color}}>
                                최종 평가 <span style={{fontWeight:800}}>{display}</span> — {verdict}
                              </div>
                            );
                          })()}
                        </div>
                        {/* Progress dots — one per player move (even indices) */}
                        {puzzleData.moves.length>1&&(
                          <div style={{display:'flex',gap:6,marginBottom:18,alignItems:'center'}}>
                            <span style={{fontSize:11,color:'#666',marginRight:4}}>진행</span>
                            {puzzleData.moves.filter((_,i)=>i%2===0).map((_,i)=>(
                              <div key={i} style={{width:12,height:12,borderRadius:'50%',
                                background:puzzleMoveIdx>i*2?'#7ecf7e':puzzleMoveIdx===i*2?'rgba(255,255,255,0.35)':'rgba(255,255,255,0.1)',
                                border:`1.5px solid ${puzzleMoveIdx>i*2?'#7ecf7e':puzzleMoveIdx===i*2?'rgba(255,255,255,0.6)':'rgba(255,255,255,0.2)'}`,
                                transition:'all 0.3s'}}/>
                            ))}
                          </div>
                        )}
                        {/* Buttons */}
                        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
                          {puzzleStatus==='playing'&&(
                            <button onClick={()=>{
                              if(puzzleMoveIdxRef.current%2===1)return;
                              const m=uciToMove(puzzleData.moves[puzzleMoveIdxRef.current],board,turn,ep);
                              if(m)setHintMove({f:m.f,t:m.t,pv:[]});
                            }} style={{padding:'8px 14px',background:'rgba(60,220,130,0.12)',color:'#3cdc82',border:'1px solid rgba(60,220,130,0.35)',borderRadius:7,fontSize:13,cursor:'pointer',fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
                              💡 힌트
                            </button>
                          )}
                          {puzzleStatus==='playing'&&(
                            <button onClick={()=>{
                              setPuzzleStatus('solved');
                              let idx=puzzleMoveIdxRef.current;
                              const playNext=()=>{
                                if(idx>=puzzleData.moves.length)return;
                                const b=bR.current,e=eR.current,c=cR.current,t=tR.current;
                                const m=uciToMove(puzzleData.moves[idx],b,t,e);
                                if(m)applyMv(b,m,e,c,t);
                                setPMI(++idx);
                                if(idx<puzzleData.moves.length)setTimeout(playNext,600);
                              };
                              setTimeout(playNext,100);
                            }} style={{padding:'8px 14px',background:'rgba(255,255,255,0.06)',color:'#b0a898',border:'1px solid rgba(255,255,255,0.14)',borderRadius:7,fontSize:13,cursor:'pointer',fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
                              👁 해답 보기
                            </button>
                          )}
                          {puzzleStatus==='solved'&&(
                            <button onClick={runPuzzleAnalysis} disabled={analyzing}
                              style={{padding:'8px 14px',background:analyzing?'rgba(160,130,220,0.06)':'rgba(160,130,220,0.15)',color:analyzing?'#7a6aaa':'#c0a0f0',border:`1px solid ${analyzing?'rgba(160,130,220,0.2)':'rgba(160,130,220,0.45)'}`,borderRadius:7,fontSize:13,cursor:analyzing?'default':'pointer',fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
                              {analyzing?`⏳ 분석 중 ${analysisProgress.current}/${analysisProgress.total}`:'📊 수 분석'}
                            </button>
                          )}
                          <button onClick={enterPuzzleMode}
                            style={{padding:'8px 14px',background:'rgba(137,212,240,0.15)',color:'#89d4f0',border:'1px solid rgba(137,212,240,0.4)',borderRadius:7,fontSize:13,cursor:'pointer',fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
                            다음 퍼즐 →
                          </button>
                        </div>
                        {/* ELO info */}
                        <div style={{fontSize:11,color:'#444',fontFamily:"'Space Mono',monospace",lineHeight:1.6}}>
                          ELO {elo} → 퍼즐 {Math.min(3000,elo+600)-200}~{Math.min(3000,elo+600)+200}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            ):reviewMode?(
              <div style={{padding:'14px 18px'}}>
                {/* Eval graph */}
                <div style={{marginBottom:14,borderRadius:7,overflow:'hidden',border:'1px solid rgba(255,255,255,0.15)'}}>
                  {renderEvalGraph()}
                </div>

                {/* Player + accuracy */}
                <div style={{display:'grid',gridTemplateColumns:'auto 1fr 1fr',gap:'6px 10px',marginBottom:14,alignItems:'center'}}>
                  <div style={{fontSize:12,color:'#8a8580'}}>플레이어</div>
                  {[pc,pc==='w'?'b':'w'].map(color=>(
                    <div key={color} style={{background:color==='w'?'rgba(220,212,200,0.07)':'rgba(40,36,32,0.5)',borderRadius:7,padding:'7px',textAlign:'center',border:'1px solid rgba(255,255,255,0.06)'}}>
                      <div style={{margin:'0 auto 3px',width:'fit-content'}}>{renderKingAvatar(color,36)}</div>
                      <div style={{fontSize:11,color:'#8a8580'}}>{color===pc?'You':'AI'}</div>
                    </div>
                  ))}
                  <div style={{fontSize:12,color:'#8a8580'}}>정확성</div>
                  {[pc,pc==='w'?'b':'w'].map(color=>{
                    const moves=moveClassifications.filter(m=>m.player===color);
                    const acc=calcAccuracy(moves);
                    return(
                      <div key={color} style={{background:color==='w'?'rgba(220,212,200,0.07)':'rgba(40,36,32,0.5)',borderRadius:7,padding:'9px',textAlign:'center',border:`2px solid ${color===pc?'rgba(255,255,255,0.22)':'rgba(255,255,255,0.04)'}`,fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:26,color:'#e8e0d5'}}>
                        {acc}
                      </div>
                    );
                  })}
                </div>

                {/* Grade breakdown */}
                <div style={{display:'flex',flexDirection:'column'}}>
                  {Object.entries(GRADE_INFO).map(([key,gi])=>{
                    const wC=moveClassifications.filter(m=>m.player==='w'&&m.grade===key).length;
                    const bC=moveClassifications.filter(m=>m.player==='b'&&m.grade===key).length;
                    const firstC=pc==='w'?wC:bC, secondC=pc==='w'?bC:wC;
                    return(
                      <div key={key} style={{display:'grid',gridTemplateColumns:'1fr auto auto auto',alignItems:'center',gap:'0 12px',padding:'9px 2px',borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                        <span style={{fontSize:14,color:'#b0a898'}}>{gi.label}</span>
                        <span style={{fontSize:17,fontWeight:700,color:firstC>0?gi.color:'#3a3530',textAlign:'right',minWidth:26,fontFamily:"'Space Mono',monospace"}}>{firstC}</span>
                        <div style={{width:34,height:34,borderRadius:'50%',background:gi.color+'18',border:`2px solid ${gi.color}55`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>{gi.sym}</div>
                        <span style={{fontSize:17,fontWeight:700,color:secondC>0?gi.color:'#3a3530',textAlign:'left',minWidth:26,fontFamily:"'Space Mono',monospace"}}>{secondC}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Coach Report */}
                {(()=>{
                  const myMoves = moveClassifications.map((m, i) => ({...m, idx: i})).filter(m => m.player === pc);
                  if (!myMoves.length) return null;
                  
                  const acc = parseFloat(calcAccuracy(myMoves));
                  const estimatedElo = Math.min(2800, Math.max(400, Math.round(3000/(1+Math.exp(-0.09*(acc-72))))));
                  
                  const opening = myMoves.filter(m => Math.floor(m.idx / 2) < 15);
                  const middle = myMoves.filter(m => Math.floor(m.idx / 2) >= 15 && Math.floor(m.idx / 2) < 30);
                  const end = myMoves.filter(m => Math.floor(m.idx / 2) >= 30);
                  
                  const getAvgCp = arr => arr.length ? arr.reduce((s, m) => s + m.cpLoss, 0) / arr.length : 0;
                  const opCp = getAvgCp(opening);
                  const midCp = getAvgCp(middle);
                  const endCp = getAvgCp(end);
                  
                  const comments = [];
                  if (opCp < 30 && opening.length > 5) comments.push("초반 오프닝이 매우 단단합니다.");
                  else if (opCp > 80) comments.push("오프닝 전개 과정에서 손실이 컸습니다.");
                  
                  if (midCp < 40 && middle.length > 5) comments.push("중반부 전술적 대처가 뛰어납니다.");
                  else if (midCp > 100) comments.push("중반 전술 싸움에서 집중력이 아쉽습니다.");
                  
                  if (endCp > 100 && end.length > 5) comments.push("엔드게임 마무리에 주의가 필요합니다.");
                  
                  const blunders = myMoves.filter(m => m.grade === 'blunder').length;
                  if (blunders >= 2) comments.push("치명적인 블런더를 줄이는 연습이 필요합니다.");
                  
                  if (comments.length === 0) comments.push("전반적으로 무난한 대국이었습니다.");
                  
                  const criticalMoves = [...myMoves].sort((a, b) => b.cpLoss - a.cpLoss).slice(0, 2).filter(m => m.cpLoss > 150);
                  
                  return (
                    <div style={{marginTop: 20, padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)'}}>
                      <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12}}>
                        <span style={{fontSize: 20}}>🤖</span>
                        <span style={{fontSize: 15, fontWeight: 700, color: '#e8d5b5'}}>코치 리포트</span>
                      </div>
                      
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, background: 'rgba(0,0,0,0.3)', padding: '10px 14px', borderRadius: 8}}>
                        <span style={{fontSize: 13, color: '#b0a898'}}>예상 퍼포먼스 ELO</span>
                        <span style={{fontSize: 20, fontWeight: 700, color: '#f0c040', fontFamily: "'Space Mono',monospace"}}>{estimatedElo}</span>
                      </div>
                      
                      <ul style={{margin: 0, paddingLeft: 20, color: '#e8e0d5', fontSize: 13, lineHeight: 1.6, marginBottom: criticalMoves.length ? 14 : 0}}>
                        {comments.map((c, i) => <li key={i} style={{marginBottom: 4}}>{c}</li>)}
                      </ul>
                      
                      {criticalMoves.length > 0 && (
                        <div>
                          <div style={{fontSize: 12, color: '#8a8580', marginBottom: 8}}>결정적 분기점 (치명적 실수)</div>
                          <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                            {criticalMoves.map(m => {
                              const turnNum = Math.floor(m.idx / 2) + 1;
                              const isWhite = m.idx % 2 === 0;
                              return (
                                <div key={m.idx} onClick={() => setViewIdx(m.idx + 1)} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(224,80,80,0.1)', border: '1px solid rgba(224,80,80,0.3)', borderRadius: 6, cursor: 'pointer', transition: 'all 0.2s'}}>
                                  <span style={{fontSize: 13, color: '#e8e0d5', fontFamily: "'Space Mono',monospace", width: 40}}>
                                    {turnNum}.{isWhite ? ' ' : '...'}
                                  </span>
                                  <span style={{fontSize: 13, color: '#e05050', fontWeight: 700}}>
                                    {sanList[m.idx]}
                                  </span>
                                  <span style={{fontSize: 12, color: '#b0a898', marginLeft: 'auto'}}>
                                    -{(m.cpLoss / 100).toFixed(1)}점
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ):(
              // Move history
              <div style={{padding:'12px 18px'}}>
                {hist.length===0?(
                  <div style={{color:'#555',fontSize:14,textAlign:'center',paddingTop:24}}>게임을 시작하세요</div>
                ):(
                  <>
                    {/* Opening Explorer */}
                    {openingInfo && (
                      <div style={{marginBottom: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12, border: '1px solid rgba(255,255,255,0.08)'}}>
                        <div style={{fontSize: 11, color: '#e8a040', fontWeight: 700, letterSpacing: 0.5, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4}}>
                          <span style={{fontSize: 14}}>📖</span> Opening Explorer
                        </div>
                        {openingInfo.outOfBook ? (
                          <div style={{fontSize: 13, color: '#b0a898', fontStyle: 'italic'}}>Out of Book (오프닝 북에서 벗어남)</div>
                        ) : (
                          <>
                            {openingInfo.opening && (
                              <div style={{fontSize: 14, fontWeight: 700, color: '#e8e0d5', marginBottom: 8, lineHeight: 1.3}}>
                                <span style={{color: '#89d4f0', marginRight: 6}}>{openingInfo.opening.eco}</span>
                                {openingInfo.opening.name}
                              </div>
                            )}
                            {openingInfo.moves && openingInfo.moves.length > 0 && (
                              <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                                <div style={{fontSize:10, color:'#666', marginBottom:2}}>마스터들의 추천 수 (승/무/패)</div>
                                {openingInfo.moves.slice(0, 3).map((m, i) => {
                                  const total = m.white + m.draws + m.black;
                                  const wp = (m.white / total) * 100;
                                  const dp = (m.draws / total) * 100;
                                  const bp = (m.black / total) * 100;
                                  return (
                                    <div key={i} style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: "'Space Mono',monospace"}}>
                                      <div style={{width: 36, fontWeight: 700, color: '#e8d5b5', cursor:'pointer'}} 
                                        onClick={()=>{if(isLive&&!thinking&&!over){const mObj=uciToMove(m.uci,board,turn,ep);if(mObj)applyMv(board,mObj,ep,cas,turn);}}}>
                                        {m.san}
                                      </div>
                                      <div style={{flex: 1, display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', opacity: 0.9}}>
                                        <div style={{width: `${wp}%`, background: '#e8d5b5'}} title={`White: ${Math.round(wp)}%`}/>
                                        <div style={{width: `${dp}%`, background: '#8a8580'}} title={`Draw: ${Math.round(dp)}%`}/>
                                        <div style={{width: `${bp}%`, background: '#333'}} title={`Black: ${Math.round(bp)}%`}/>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                      <div style={{fontSize:11,color:'#666',fontWeight:700,letterSpacing:0.8,textTransform:'uppercase'}}>수 기록</div>
                      <div style={{display:'flex',gap:6}}>
                        <button onClick={handleImportPGN} style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'#b0a898',fontSize:10,padding:'3px 6px',borderRadius:4,cursor:'pointer',fontWeight:700}}>📥 불러오기</button>
                        <button onClick={handleExportPGN} style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'#b0a898',fontSize:10,padding:'3px 6px',borderRadius:4,cursor:'pointer',fontWeight:700}}>📋 내보내기</button>
                      </div>
                    </div>
                    <div ref={moveListRef} style={{display:'flex',flexDirection:'column',gap:1,maxHeight:320,overflowY:'auto'}}>
                      {Array.from({length:Math.ceil(sanList.length/2)}).map((_,i)=>{
                        const w=sanList[i*2],b=sanList[i*2+1];
                        const wMc=moveClassifications[i*2];const bMc=moveClassifications[i*2+1];
                        const wGi=wMc?GRADE_INFO[wMc.grade]:null;const bGi=bMc?GRADE_INFO[bMc.grade]:null;
                        return(
                          <div key={i} style={{display:'grid',gridTemplateColumns:'28px 1fr 1fr',gap:4,padding:'3px 4px',borderRadius:4,background:i%2===0?'transparent':'rgba(255,255,255,0.02)'}}>
                            <span style={{fontSize:12,color:'#555',fontFamily:"'Space Mono',monospace",paddingTop:3}}>{i+1}.</span>
                            {w&&<span data-ply={i*2} onClick={()=>setViewIdx(i*2+1)}
                              style={{fontSize:13,color:activeHistIdx===i*2?'#f0c040':'#e8d5b5',cursor:'pointer',fontFamily:"'Space Mono',monospace",display:'flex',alignItems:'center',gap:3,fontWeight:activeHistIdx===i*2?700:400,background:activeHistIdx===i*2?'rgba(240,192,64,0.12)':'transparent',borderRadius:3,padding:'2px 5px'}}>
                              {w}{wGi&&<span style={{fontSize:10,color:wGi.color}}>{wGi.sym}</span>}
                            </span>}
                            {b&&<span data-ply={i*2+1} onClick={()=>setViewIdx(i*2+2)}
                              style={{fontSize:13,color:activeHistIdx===i*2+1?'#f0c040':'#8aa8d5',cursor:'pointer',fontFamily:"'Space Mono',monospace",display:'flex',alignItems:'center',gap:3,fontWeight:activeHistIdx===i*2+1?700:400,background:activeHistIdx===i*2+1?'rgba(240,192,64,0.12)':'transparent',borderRadius:3,padding:'2px 5px'}}>
                              {b}{bGi&&<span style={{fontSize:10,color:bGi.color}}>{bGi.sym}</span>}
                            </span>}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Bottom actions */}
          {analyzing&&(
            <div style={{padding:'12px 18px',borderTop:'1px solid rgba(255,255,255,0.08)',flexShrink:0}}>
              <div style={{fontSize:12,color:'#e8a040',marginBottom:6,textAlign:'center',fontFamily:"'Space Mono',monospace"}}>
                분석 중... {analysisProgress.current}/{analysisProgress.total}
              </div>
              <div style={{height:5,background:'rgba(255,255,255,0.06)',borderRadius:3}}>
                <div style={{height:'100%',background:'#e8a040',borderRadius:3,transition:'width 0.3s',width:`${analysisProgress.total?Math.round(analysisProgress.current/analysisProgress.total*100):0}%`}}/>
              </div>
            </div>
          )}
          {over&&!analyzing&&!reviewMode&&!puzzleMode&&hist.length>1&&(
            <div style={{padding:'12px 18px',borderTop:'1px solid rgba(255,255,255,0.08)',flexShrink:0}}>
              <button onClick={runAnalysis}
                style={{width:'100%',padding:'14px',background:'#4e8c35',color:'#fff',border:'none',borderRadius:8,fontWeight:700,fontSize:16,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",letterSpacing:0.3}}>
                리뷰 시작
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Eval graph hover tooltip */}
      {evalGraphHover&&(
        <div style={{position:'fixed',left:evalGraphHover.clientX+14,top:evalGraphHover.clientY-44,
          background:'#1e1c1a',border:'1px solid rgba(255,255,255,0.2)',borderRadius:7,
          padding:'5px 10px',fontSize:12,color:'#e8e0d5',pointerEvents:'none',zIndex:9999,
          boxShadow:'0 4px 16px rgba(0,0,0,0.7)',display:'flex',alignItems:'center',gap:8,whiteSpace:'nowrap'}}>
          <span style={{fontFamily:"'Space Mono',monospace",fontWeight:700}}>{evalGraphHover.label}</span>
          {evalGraphHover.evalVal!=null&&(
            <span style={{color:evalGraphHover.evalVal>=0?'#89d4f0':'#e05050',fontFamily:"'Space Mono',monospace"}}>
              {evalGraphHover.evalVal>=0?'+':''}{(evalGraphHover.evalVal/100).toFixed(2)}
            </span>
          )}
          {evalGraphHover.cls&&(
            <span style={{color:GRADE_INFO[evalGraphHover.cls]?.color,fontWeight:700}}>
              {GRADE_INFO[evalGraphHover.cls]?.sym} {GRADE_INFO[evalGraphHover.cls]?.label}
            </span>
          )}
        </div>
      )}

      {/* ── Opponent gallery (chess.com-style character picker) ── */}
      {showBotPicker&&(
        <div onClick={()=>setShowBotPicker(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.72)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
          <div onClick={e=>e.stopPropagation()} className="bot-modal"
            style={{background:'#2c2a28',borderRadius:14,boxShadow:'0 10px 40px rgba(0,0,0,0.7)',width:'min(720px,100%)',maxHeight:'90vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.08)'}}>
              <div>
                <div style={{fontSize:18,fontWeight:700,color:'#e8e0d5',fontFamily:"'Space Mono',monospace"}}>♟ 상대를 선택하세요</div>
                <div style={{fontSize:12,color:'#8a8580',marginTop:2}}>캐릭터마다 점수와 플레이 성격이 달라요</div>
              </div>
              <button onClick={()=>setShowBotPicker(false)}
                style={{background:'rgba(255,255,255,0.08)',color:'#ccc',border:'1px solid rgba(255,255,255,0.14)',borderRadius:7,width:32,height:32,fontSize:16,cursor:'pointer'}}>✕</button>
            </div>
            <div style={{padding:16,overflowY:'auto'}}>
              <div className="bot-grid">
                {BOTS.map(bot=>{
                  const sel=selectedBot.id===bot.id;
                  return(
                    <button key={bot.id} onClick={()=>selectBot(bot)}
                      style={{textAlign:'left',display:'flex',flexDirection:'column',gap:6,padding:12,borderRadius:10,cursor:'pointer',
                        background:sel?`${bot.color}1f`:'rgba(255,255,255,0.04)',
                        border:`2px solid ${sel?bot.color:'rgba(255,255,255,0.08)'}`,transition:'all 0.15s'}}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        {renderBotAvatar(bot,44)}
                        <div style={{minWidth:0}}>
                          <div style={{fontSize:15,fontWeight:700,color:'#e8e0d5',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{bot.name}</div>
                          <div style={{fontSize:12,color:bot.color,fontFamily:"'Space Mono',monospace",fontWeight:700}}>ELO {bot.elo}</div>
                        </div>
                      </div>
                      <div style={{fontSize:12,fontWeight:700,color:'#cbb89a'}}>{bot.title}</div>
                      <div style={{fontSize:11,color:'#8a8580',lineHeight:1.4}}>{bot.bio}</div>
                    </button>
                  );
                })}
              </div>

              {/* Custom ELO */}
              <div style={{marginTop:18,padding:14,borderRadius:10,background:'rgba(255,255,255,0.04)',border:`2px solid ${selectedBot.id==='custom'?'#9aa0a6':'rgba(255,255,255,0.08)'}`}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                  <span style={{fontSize:20}}>🎚️</span>
                  <span style={{fontSize:14,fontWeight:700,color:'#e8e0d5'}}>커스텀 — ELO 직접 설정</span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <input type="range" min={600} max={2400} step={1} value={elo}
                    onChange={e=>{setSelectedBot(CUSTOM_BOT);setElo(+e.target.value);}}
                    style={{flex:1,minWidth:160,appearance:'none',height:6,background:'linear-gradient(to right,#5cb85c,#e8a040,#d04040)',borderRadius:3,outline:'none',cursor:'pointer'}}/>
                  <input type="number" min={600} max={2400} step={1}
                    value={eloInput!==''?eloInput:elo}
                    onFocus={e=>{setEloInput(String(elo));e.target.select();}}
                    onChange={e=>{const raw=e.target.value;setEloInput(raw);const v=parseInt(raw);if(!isNaN(v)&&v>=600&&v<=2400){setSelectedBot(CUSTOM_BOT);setElo(v);}}}
                    onKeyDown={e=>{if(e.key==='Enter'){const v=parseInt(e.target.value);if(!isNaN(v)){setSelectedBot(CUSTOM_BOT);setElo(Math.max(600,Math.min(2400,v)));}setEloInput('');e.target.blur();}}}
                    onBlur={()=>setEloInput('')}
                    style={{width:70,padding:'6px 8px',background:'rgba(255,255,255,0.08)',color:d.color,border:'1px solid rgba(255,255,255,0.2)',borderRadius:6,fontSize:14,fontFamily:"'Space Mono',monospace",fontWeight:700,textAlign:'center',outline:'none'}}/>
                  <span style={{fontSize:13,fontWeight:700,color:d.color,fontFamily:"'Space Mono',monospace",minWidth:46}}>{d.name}</span>
                  <button onClick={()=>{setSelectedBot(CUSTOM_BOT);try{localStorage.removeItem(BOT_STORE_KEY);}catch(err){}setShowBotPicker(false);reset();}}
                    style={{padding:'7px 14px',background:'#e8d5b5',color:'#111',border:'none',borderRadius:7,fontWeight:700,fontSize:13,cursor:'pointer',fontFamily:"'DM Sans',sans-serif",whiteSpace:'nowrap'}}>이 난이도로 새 게임</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        .bot-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}
        @media (max-width:560px){.bot-grid{grid-template-columns:1fr;}}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.14);border-radius:3px}
        input[type=range]::-webkit-slider-thumb{appearance:none;width:18px;height:18px;border-radius:50%;background:#e8d5b5;border:2px solid #262421;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.5)}
        input[type=range]::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:#e8d5b5;border:2px solid #262421;cursor:pointer}
        
        /* Default Desktop Layout */
        .top-bar { height:52px; background:#1a1816; border-bottom:1px solid rgba(255,255,255,0.1); display:flex; align-items:center; padding:0 20px; gap:10px; flex-shrink:0; }
        .top-title { display:flex; align-items:baseline; gap:10px; margin-right:2px; }
        .top-buttons { display:flex; gap:10px; }
        .elo-controls { display:flex; align-items:center; gap:8px; margin-left:auto; }
        .main-layout { flex:1; display:flex; flex-direction:row; overflow:hidden; min-height:0; }
        .board-section { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:10px 20px; min-width:0; }
        .right-panel { width:400px; background:#111; border-left:1px solid rgba(255,255,255,0.05); display:flex; flex-direction:column; overflow:hidden; flex-shrink:0; box-shadow:-10px 0 30px rgba(0,0,0,0.5); }
        .player-row { width:min(calc(100vh - 142px), calc(100vw - 438px), 742px); }
        .chess-board { width:min(calc(100vh - 184px), calc(100vw - 480px), 700px); height:min(calc(100vh - 184px), calc(100vw - 480px), 700px); }
        .eval-bar { height:min(calc(100vh - 184px), calc(100vw - 480px), 700px); }
        .chess-piece { display: block; }

        /* Responsive Mobile Layout */
        @media (max-width: 900px) {
          .hide-on-mobile { display: none !important; }
          /* Wrap the top bar instead of overflowing off-screen on narrow phones */
          .top-bar { height: auto; min-height: 52px; padding: 6px 10px; gap: 6px 8px; justify-content: space-between; flex-wrap: wrap; }
          .top-buttons { gap: 6px; flex-wrap: wrap; }
          .top-title { margin-right: 0; }
          .elo-controls { margin-left: 0; }

          .main-layout { flex-direction: column; overflow-y: auto; }
          .board-section { padding: 10px 5px; flex: none; }
          .right-panel { width: 100%; border-left: none; border-top: 1px solid rgba(255,255,255,0.1); flex: none; height: auto; min-height: 400px; box-shadow: none; }

          /* 642 = board cap (600) + eval bar (42) so the player rows line up with the board */
          .player-row { width: 100%; max-width: 642px; }
          .chess-board { width: calc(100vw - 52px); height: calc(100vw - 52px); max-width: 600px; max-height: 600px; }
          .eval-bar { height: calc(100vw - 52px); max-height: 600px; }
          .app-container { overflow-y: auto !important; height: auto !important; min-height: 100vh; }
        }
      `}</style>
    </div>
  );
}
