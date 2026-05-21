# 퍼즐 분석 모드 — 미래 플랜

## Context

현재 퍼즐 모드는 정답/오답만 알려주고 끝남. 사용자가 "왜 이 수가 좋은지", "다른 수를 뒀으면 어떻게 됐을지" 알기 어려움. 특히 `+1.8 유리`/`+0.7 약간 유리` 같은 위치적 우위는 직관적으로 이해하기 어려워서, **수별 평가 그래프 + 보드 전후 네비게이션 + 대안 수 비교**가 필요.

라이브 게임에는 이미 `reviewMode` + `runAnalysis()` 인프라(eval graph, 무브 분류, 네비게이션, 코치 리포트)가 존재함. 이걸 퍼즐 모드에도 확장하는 것이 골자.

이 문서는 **즉시 구현 대상이 아닌 미래 작업**의 설계 명세.

---

## 현재 상태 (코드 베이스 파악 결과)

`chess-stockfish-engine.jsx` (~1970 lines):

- **`reviewMode`** state (라인 462): 라이브 게임 종료 후 분석 UI 활성화 플래그
- **`runAnalysis()`** (라인 1079-1170): `histStates`를 순회하며 Stockfish로 각 포지션 평가, `analysisEvals[]`/`moveClassifications[]`/`bestMoves[]` 생성, 완료 후 `setReviewMode(true)`
- **`renderEvalGraph()`**: eval graph 렌더링 (라이브에서 사용 중)
- **네비게이션**: `viewIdx` + `histStates` + `goBack`/`goFwd` (라인 1251-1256)
- **PV 탐색**: `pvExploreIdx` + `pvExploreStates` — 힌트 PV에서 분기 탐색
- **퍼즐 모드의 문제**: `histStates`는 시작 포지션 1개만 들어있고, 퍼즐 진행 중 갱신되지 않음 (라인 813). 즉 현재로선 퍼즐 종료 후 보드 네비게이션 불가능.

---

## 목표 UX 흐름

1. 퍼즐 풀이 완료(✓ 정답) 또는 해답 보기(👁) 후 패널에 **"📊 분석"** 버튼 등장
2. 클릭하면 퍼즐 분석 모드 진입:
   - 좌측 보드: 현재 보고 있는 위치 (시작 → 솔루션 마지막)
   - 우측 패널: **수별 eval graph** (가로축 = 수 인덱스, 세로축 = centipawn)
   - 그래프 점 클릭 또는 ← / → 버튼으로 보드 네비게이션
   - 각 수에 "최선의 수" 비교 + cpLoss 표시 (라이브 reviewMode와 동일 분류)
3. **각 플레이어 수 위치에서** 추가 인사이트:
   - 정답 수의 PV (대안 수가 어떻게 패배로 이어지는지)
   - "이 수가 왜 좋은가": Stockfish가 추천하는 다음 3-5수 미니 PV
4. **"🔍 다른 수 탐색"** 버튼: 현재 위치에서 사용자가 임의의 수를 클릭 → PV 탐색 모드로 분기 (기존 `enterPVExplore` 재사용)
5. **"퍼즐 종료"** / **"다음 퍼즐 →"** 버튼으로 빠져나오기

---

## 구현 계획 (Phase 별)

### Phase 1: 퍼즐 진행 중 `histStates` 채우기

현재 퍼즐 모드는 `puzzleMoveIdx`와 `puzzleData.moves[]`만 사용하고 `histStates`는 시작 포지션만 가짐.

수정 대상:
- **Auto-play useEffect** (라인 826-841): `applyMv` 호출 후 `histStates`에 새 state 추가
- **click handler** (라인 838-866): 플레이어 수 적용 후 마찬가지
- **doPromo** (라인 868-883): 프로모션 수 적용 후 마찬가지

각 수에 대해 push되는 객체:
```js
{ board, turn, ep, cas, last:{f,t}, capW, capB, /* puzzle 전용 */ moveIdx, isPlayerMove }
```

`isPlayerMove` 플래그는 짝수 idx(0,2,4...)에서 true. 분석 UI에서 플레이어 수만 cpLoss 표시할 때 사용.

### Phase 2: 분석 모드 진입 트리거

- 새 state: `puzzleAnalysisMode` (boolean) — `reviewMode`와 별개로 관리 (라이브 review와 충돌 방지)
- 또는 기존 `reviewMode` 재사용 + `puzzleMode && reviewMode`로 구분
- **추천: 별도 state**. 라이브 review의 코치 리포트/정확성 카드는 퍼즐에선 의미 없음
- 퍼즐 패널의 `puzzleStatus === 'solved'` 분기에 "📊 분석" 버튼 추가
- 버튼 onClick:
  ```js
  setPuzzleAnalysisMode(true);
  // 모든 histStates 위치에 대해 Stockfish 평가
  await analyzePuzzleHistory();
  ```

### Phase 3: `analyzePuzzleHistory()` — 퍼즐 전용 분석 함수

`runAnalysis()`를 그대로 쓰기엔:
- 라이브 게임용 코치 리포트 로직 불필요
- 오프닝 북 lookup 불필요 (퍼즐 포지션은 게임 중반/종반)
- `setReviewMode(true)` 부작용 원치 않음

→ **신규 함수**: `runPuzzleAnalysis()` — `runAnalysis`에서 다음만 추출:
1. Stockfish iteration over `histStates`
2. cp loss 계산 (전 수와 비교)
3. `analysisEvals[]`, `moveClassifications[]`, `bestMoves[]` 채우기 (기존 state 재사용)

완료 후 `setPuzzleAnalysisMode(true)` + `viewIdx=0`으로 시작 포지션부터 표시.

### Phase 4: 분석 UI 패널

기존 review 패널(라인 1701-1810) 코드를 참고해 **퍼즐 전용 슬림 버전** 작성:

1. **Eval graph** — `renderEvalGraph()` 그대로 재사용 가능. 입력은 동일한 `analysisEvals`. 가로축 라벨만 "플레이어 수 1, 2, 3..."로 변경
2. **Move list** — 각 수의 UCI + 분류(`best`/`good`/`mistake` 등) + cpLoss
   - 플레이어 수만 분류 표시, 상대 수는 회색
3. **네비게이션** — `goBack`/`goFwd` 기존 그대로 사용
4. **현재 수 인사이트** (`viewIdx` 위치):
   - 플레이어 수면: "당신의 수: X (최선)" 또는 "당신의 수: X | 최선: Y (-N점)"
   - 상대 수면: "상대 강제 응수: X"
   - 하단에 Stockfish PV 1줄 (다음 5수 정도)
5. **버튼**:
   - "🔍 이 위치에서 다른 수 시도" → 보드에 클릭 가능 모드 활성화, 클릭 시 `enterPVExplore` 호출
   - "다음 퍼즐 →" (기존)
   - "퍼즐 종료" (`reset()`)

### Phase 5: 보드 인터랙션 분기

분석 모드에서 보드 클릭 시:
- 기본: 비활성 (감상용)
- "다른 수 시도" 토글 켜진 경우: 사용자가 합법 수 클릭 → `findBestMove` 또는 Stockfish로 그 수 이후 PV 계산 → `enterPVExplore(...)` 호출. 즉 사용자가 선택한 분기로 PV 탐색 진입.

기존 click handler (라인 838)는 puzzleMode/reviewMode 조건이 복잡함. 새 모드를 깔끔히 추가하려면 가드 라인 한 줄 추가:
```js
if(puzzleAnalysisMode && !puzzleExperimentMode) return;
```

`puzzleExperimentMode`: "다른 수 시도" 토글 상태.

---

## 수정 대상 파일

- `chess-stockfish-engine.jsx` — 모든 변경 집중 (이 앱의 단일 컴포넌트)
- `CLAUDE.md` — "Puzzle analysis mode" 짧은 섹션 추가
- 신규 테스트: `scripts/test-puzzle-analysis.cjs` — `histStates` 누적이 매 수마다 1씩 증가하는지, eval normalization 정확한지 (플레이어 색 기준 부호) 검증

---

## 재사용할 기존 코드 (file:line)

| 기능 | 위치 | 재사용 방법 |
|---|---|---|
| 보드 상태 push 패턴 | 라인 585 (라이브 게임 수) | 퍼즐 auto-play/click에서 같은 패턴 적용 |
| Stockfish 1회 호출 + 콜백 | 라인 920-961 (`handleHint`) | analyzePuzzleHistory에서 반복 호출용으로 추출 |
| cp loss → 분류 | `classifyMove()` (라인 375-382) | 그대로 사용 |
| Eval graph 렌더 | `renderEvalGraph()` | 그대로 사용 |
| 네비게이션 | `goBack`/`goFwd`, `viewIdx` (라인 1251-1256) | 그대로 사용 |
| PV 탐색 진입 | `enterPVExplore()` (라인 749) | "다른 수 시도"에서 호출 |

---

## 검증 방법

### 자동 (`scripts/test-puzzle-analysis.cjs` 신규)
1. 퍼즐 진행 시뮬레이션 → `histStates.length`가 매 수마다 +1
2. 모든 히스토리 포지션이 FEN 합법, last move가 정확히 직전 수
3. 분석 결과 `analysisEvals`가 `histStates`와 길이 일치, 플레이어 수의 cpLoss는 ≤ 50 (퍼즐은 최선의 수임)

### 브라우저 수동
1. 퍼즐 풀이 완료 → "📊 분석" 버튼 클릭 → eval graph 표시
2. ← / → 또는 그래프 점 클릭 → 보드가 해당 포지션으로 이동, "당신의 수"/"상대 수" 안내 갱신
3. "🔍 이 위치에서 다른 수 시도" 토글 → 보드에서 임의 합법 수 클릭 → PV 탐색 모드로 분기, 본 라인과 비교 가능
4. "퍼즐 종료" → 게임 보드로 복귀
5. "다음 퍼즐 →" → 분석 상태 모두 초기화, 새 퍼즐 로드
