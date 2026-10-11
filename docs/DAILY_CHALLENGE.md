# 오늘의 도전 — 계약 초안

작성: 2026-10-11 · 기준: main 0.19.25
상태: **사용자 결정 대기. 아래는 추천안이며 구현·배포 전이다.**

[품질 로드맵 6단계](QUALITY_ROADMAP.md)의 날짜별 트랙·기체·난이도 선택을 확장한다. Codex는 선택·판정·기록·보상, Claude는 진입 카드·조건 진행·결과 표시를 맡는다. 로그인·서버 순위표는 이번 범위에 넣지 않는다.

## 사용자에게 정할 항목

### 1. 보상 크기

도전 성공에 대한 **하루 총 지급액**이다. 일반 완주·클린·신기록·첫 통과 보상은 별도로 더하지 않는다. 충돌 벌점도 이 고정 보상에서 차감하지 않는다. 조건 실패·중도 포기는 0P.

| 선택 | 지급 | 판단 |
| --- | ---: | --- |
| 가벼운 출석 보상 | 75P | 집중 모드 1개(60P)보다 조금 많고 지원 미사일 1발(100P)보다 적다. |
| **추천: 일반 완주 한 번 수준** | **150P** | 현재 중간 난이도 완주와 같고, 300P 첫 강화의 절반. 매일 돌아올 동기를 주면서 일반 경기를 대체하지 않는다. |
| 큰 일일 보상 | 250P | 고급 완주 220P보다 많다. 성장은 빠르지만 일일 도전 의존도가 높아진다. |

현재 가격·보상의 근거: [상점과 포인트](SHOP_PROGRESSION.md), `catalog.ts`의 강화·아이템 가격, `progress.ts`의 완주 보상.

### 2. 조건 종류

모든 안에 정상 완주가 필요하다. 1차 도전은 타임어택이며 랩별 제한 시간·실격은 기존 규칙을 따른다. 별 1개 이상 통과를 성공의 기본 조건으로 쓴다.

| 선택 | 추가 목표 | 판단 |
| --- | --- | --- |
| 완주형 | 추가 목표 없음 | 진입 장벽이 가장 낮다. 날짜별 트랙·기체만으로 변화를 준다. |
| **추천: 기본 주행 순환형** | 부스트 3회 / 장애물 안전 통과 3회 / 1단계 이상 드리프트 종료 1회 중 **하나** | 기존 조작을 활용하고 실수 뒤에도 목표를 채울 수 있다. 3랩 전체의 누적 조건이다. |
| 기술형 | 니어미스 1회 / 패링 성공 1회 / 충돌·이탈 0회 중 하나 | 기술 연습에는 좋지만 실패 부담이 크다. 위험에 접근하도록 유도하므로 초기 기본값으로는 추천하지 않는다. |

추천안은 추가 목표를 하나만 고른다. 니어미스·패링·무충돌 조건은 기술형을 고르기 전까지 생성하지 않는다. 드리프트 충전 단계는 기존 0.6초/1단계 기준을 읽고, 종료 보상 이벤트가 실제 발생했을 때만 센다.

### 3. ‘하루 1회 기록’의 의미

| 선택 | 기록·재도전 | 판단 |
| --- | --- | --- |
| **추천: 하루 기록 한 칸 + 보상 한 번** | 재도전 가능. 그 날짜의 성공 최고 기록만 갱신하며 첫 성공 때 한 번 지급 | 연습하고 더 잘 달릴 수 있다. 보상 반복 획득은 막는다. |
| 하루 공식 출전 한 번 | 출발 시 공식 기회를 저장해 소비. 실패·포기·종료도 기회 소진. 이후는 무보상 연습 | 도전의 긴장감은 크지만 모바일 중단·실수의 부담이 크다. |

이 항목은 사용자 문구의 해석이 갈릴 수 있어 확정이 필요하다. 아래 세부 계약과 API는 **추천안** 기준이다. 공식 출전 한 번을 고르면 출발 예약 트랜잭션·연습 구분을 추가한다.

## 날짜와 동일 조건

- 날짜 경계는 **한국 시간(Asia/Seoul) 00:00**으로 제안한다. 기기의 표시 언어·시간대와 무관하게 같은 순간 같은 도전이다. `dailyDateKey(nowMs)`는 UTC 밀리초를 받아 `YYYY-MM-DD`를 반환한다. 잘못된 날짜·NaN은 거부한다.
- 시드는 `daily-v1:<dateKey>`를 UTF-8 FNV-1a 32비트로 해시한다. 트랙·기체·난이도·조건·환경은 각각 이름을 붙인 독립 시드로 고른다. `Math.random()`, 프로필, 소유 목록, 카탈로그 배열 순서를 선택 입력으로 쓰지 않는다.
- 후보 ID를 정렬하고 시드의 unsigned 값을 후보 수로 나눈 나머지로 선택한다. 후보 목록과 선택 규칙을 버전으로 고정한다. 새 기체·트랙 추가는 명시적으로 다음 선택 버전에 편입한다.
- 같은 날짜·선택 버전·게임 규칙 버전에서 같은 명세가 나온다. `challengeId`에는 날짜와 트랙 revision·기체 성능·난이도·랩·환경·조건·보상을 포함한 정규화 명세의 식별자를 넣는다. 게임 규칙/성능 변경은 최고 기록 비교를 분리한다. **보상 영수증은 날짜만으로 묶어**, 같은 날 업데이트해도 두 번 지급하지 않는다.
- 서버 시계가 없는 기기 저장 기능이다. 기기 시계 변경·저장 데이터 삭제를 통한 재수령 방지는 이번 범위에서 보장하지 않는다. 추후 서버가 날짜·명세·보상을 검증할 수 있도록 순수 선택 함수와 주입 가능한 시계를 둔다.

## 경기 규칙 제안

| 항목 | 추천 계약 |
| --- | --- |
| 트랙 | 정식 캠페인 48개 중 rating 1~3, 기본 기체로 제한 시간 통과 검증을 마친 후보. 기능 테스트 트랙 제외. 첫 배포에서 후보 ID를 확정한다. |
| 잠긴 트랙 | 오늘의 도전 안에서만 대여 진입 허용. 캠페인 해금·선택·별·통과 기록에는 영향 없음. 모두 해금 테스트 플래그도 선택에 영향 없음. |
| 기체 | 기존 5기체 중 하나의 기본 성능을 대여. 구매·장착 상태와 무관하며 소유권·강화·격납고 장착 상태를 바꾸지 않음. |
| 난이도 | `RaceChallengeId`의 easy/normal 중 하나. 트랙 rating·고도 단계와 별개다. hard는 초기 후보에서 제외. |
| 랩·통과 | 해당 트랙의 기존 laps, 제한 시간, 실격 및 별 판정 재사용. 제한을 넘긴 완주도 결과는 보여 주되 성공·공식 최고 기록·보상에는 넣지 않음. |
| 기본 능력 | 부스트·드리프트·패링·도로 아이템/각성 허용. 아이템 초기 배치와 환경 선택도 명세의 seed로 재현. |
| 소모 장비 | 집중 모드·상대 아이템 미장착. 소유 재고 예약·소비 없음. NPC 없음. |
| 조작 | 터치/키보드/게임패드 모두 같은 목표 수치. 현재 접근성·품질·자동 조향 설정은 유지하고 기록에 조작 모드/보조 설정을 함께 보관. 향후 순위표 그룹은 별도 결정. |
| 저장 | 일반 PB·고스트·캠페인 보상 경로와 분리된 daily 세션. 기존 `test=1`/튜토리얼로 위장하지 않고 명시적인 daily 진입으로 구분. |

후보 확정 전 5기체×쉬움/중간에서 완주 및 제한 시간 가능성을 확인한다. 부스트는 기존 `boostUses`, 안전 통과는 기존 장애물별·랩별 1회 이벤트를 쓴다. 드리프트는 정상 종료 보상 이벤트 ID로 중복 집계를 막는다. 추가 목표가 가능한 트랙/설정 조합만 후보로 넣으며 불가능한 조건을 뽑고 나서 플레이어에게 실패시키지 않는다. 기술형을 선택하면 전기 장애물·지뢰 유무 및 니어미스 대상의 도달 가능성도 후보 검증에 추가한다.

`finish`는 target=1이며 정상 통과 후 current=1이 된다. 누적 목표는 `current >= target`이면 done. `clean`만 target=0, current=충돌+이탈 횟수이고 정상 통과 때 current=0이어야 done이다. 화면 진행률은 누적 목표에서 0~1로 제한하며 clean은 진행 중 유지/실패로 표시한다. 각성의 무충돌 처리만으로 패링 성공을 만들지는 않는다.

## 판정·저장·중복 방지

1. 진입 시 날짜·명세·현재 규칙을 검증하고 세션에 복사한다. 출발 직전 날짜가 바뀌면 새 명세를 다시 보여 준다. 출발 후에는 명세를 고정한다.
2. 경기 중 `goals`를 실제 주행 이벤트로 갱신한다. 목표를 먼저 채워도 완주까지 성공 확정은 하지 않는다. 재시작 시 진행률은 0으로 돌아간다. 일시정지에서는 주행 시간과 조건 집계 모두 멈춘다.
3. 자정을 넘어 완주해도 **출발한 날짜**에 기록·보상을 정산한다. 그 결과 화면의 재도전은 현재 날짜의 새 도전으로 진입한다. 이전 날짜 도전을 URL로 새로 출발시킬 수는 없다.
4. 결과는 Codex 정산 브리지가 내부 세션 명세·완주 증거로 만든다. UI의 `goals.done`, URL의 보상값·기체·난이도는 정산 입력으로 신뢰하지 않는다. 변조된/만료된 명세·규칙은 저장 거부하고 새 도전 진입을 안내한다.
5. `Progress`에 optional `daily`를 추가하며 기존 프로필은 빈 daily로 이전한다. 날짜별 기록·수령 영수증·balance 변경을 기존 **IndexedDB `ProgressRepository.transact()` 한 번**에서 처리한다. 두 탭 동시 완주·동일 결과 재호출·새로고침에도 첫 성공만 지급한다. localStorage에 별도 지급 플래그를 두지 않는다.
6. 하루 기록은 `challengeId`가 같은 성공 기록 중 total이 가장 작은 것 하나. 동률이면 기존 것을 유지한다. 실패가 성공 기록을 덮지 않으며, 이미 수령한 날의 더 빠른 성공은 최고 기록만 바꾼다.
7. 세부 기록은 최근 30일만 보관한다. 보상 수령 날짜의 작은 영수증은 삭제하지 않는다(기록 정리·revision 변경으로 지급 제한이 풀리지 않게). 지갑·기존 보상·캠페인 데이터는 그대로 이전한다.
8. 저장 실패 시 포인트를 메모리에 선지급하지 않는다. 같은 결과를 재시도할 수 있고 성공 후에만 `awarded` 표시. 저장을 못 해도 주행과 결과 열람은 가능하다. 닫힌 탭의 미저장 결과 복구는 첫 버전에서 보장하지 않는다.

## Claude 화면 연결용 API 초안

**아직 export는 없다.** 사용자 결정 후 아래 이름을 기준으로 `src/game/progression/dailyChallenge.ts`(DOM 없는 선택·판정)와 저장 명령/레이스 브리지를 구현한다. `DailyPolicy`는 사용자 결정으로 확정될 배포 상수이며 URL에서 받지 않는다.

```ts
import type { RaceChallengeId } from '../track/raceChallenge.js';
import type { Progress } from './progress.js';

export type DailyGoalId = 'finish' | 'boost' | 'safe-pass' | 'drift'
  | 'near-miss' | 'parry' | 'clean';
export interface DailyPolicy {
  selectionVersion: string;
  rewardPoints: number;
  conditions: 'finish-only' | 'basic' | 'technical';
  // 이 초안은 재도전 허용 + 보상 한 번. 출전 한 번은 결정 후 별도 계약.
}
export interface DailyGoal {
  id: DailyGoalId;
  target: number;
}
export interface DailyChallenge {
  dateKey: string;             // KST YYYY-MM-DD
  challengeId: string;         // date + selection/rules/track/craft versions
  seed: number;
  trackId: string;
  trackRevision: number;
  craftId: string;
  challenge: RaceChallengeId;  // 초기 후보 easy | normal
  mode: 'time-attack';
  environmentId: string;
  laps: number;
  rewardPoints: number;
  goals: readonly DailyGoal[];
}
export interface DailyRunRecord {
  challengeId: string;
  raceId: string;
  total: number;
  laps: readonly number[];
  recordedAt: string;          // ISO timestamp
  controlMode: 'touch' | 'keyboard' | 'gamepad';
  assistanceId: string;        // 조향 보조 등 결과 시점의 설정 식별자
}
export interface DailySnapshot {
  challenge: DailyChallenge;
  status: 'ready' | 'running' | 'success' | 'failed';
  goals: readonly (DailyGoal & { current: number; done: boolean })[];
  best: DailyRunRecord | null;
  rewardClaimed: boolean;      // 명세 변경과 무관한 날짜 영수증
}
export interface DailySettlement {
  success: boolean;
  awarded: number;             // 이번 트랜잭션의 실제 지급, 재호출 = 0
  rewardClaimed: boolean;
  isNewBest: boolean;
  best: DailyRunRecord | null;
}

export function dailyDateKey(nowMs: number): string;
export function dailyChallengeFor(dateKey: string, policy: DailyPolicy): DailyChallenge;
export function dailySnapshot(profile: Progress, challenge: DailyChallenge): DailySnapshot;
```

`DailySnapshot.status/goals`의 주행 중 값은 세션이 제공한다. 위 `dailySnapshot()`은 진입 화면의 ready 상태를 만든다. `RaceSnapshot.daily: DailySnapshot | null`을 추가하고 기존 레이스 render 흐름으로 갱신한다. 조건 문구는 id/target/current를 Claude가 번역·표시한다. 타입에 UI 문구·HTML·색·레이아웃을 넣지 않는다.

진입점 제안은 `startDailyChallenge()`와 `restartDailyChallenge()`. 재시작도 현재 날짜를 다시 확인한다. Codex가 진입/정산/통계 수집을 맡고, Claude는 버튼·카드·목표 진행·기존 결과 영역의 일일 보상 표시를 연결한다. `DailySettlement`는 저장 명령의 응답으로 결과 화면에 전달하며 UI가 직접 지급하지 않는다. 실제 공개 함수 시그니처는 구현 커밋에서 확정해 알린다.

## 구현 때 필요한 검증

- KST 자정 직전/직후, 윤년·월말, 시간대 변경, 잘못된 날짜, 고정 날짜의 golden 명세, 후보 순서/프로필/소유권/해금 독립성.
- 날짜별 후보에 불가능한 조건 없음, 무강화 대여 기체, 장비 미소비, 세 조작 방식의 목표 집계, 드리프트/패링 이벤트 중복 방지, 일시정지·포기·재시작 초기화.
- 정상 통과+추가 목표의 AND 판정, 제한 시간 초과·실격, 첫 성공/재성공/더 빠른 성공/동률/실패 뒤 성공, 자정 넘긴 결과와 현재 날짜 재진입.
- 두 탭 동시 정산, 동일 raceId 재시도, DB 실패/복구, 이전 프로필 이전, 기록 30일 정리 후 영수증 유지, 업데이트로 challengeId가 바뀌어도 같은 날 추가 지급 없음.
- daily 세션이 일반 PB/고스트·캠페인 해금/별·일반 보상에 쓰이지 않음, 모두 해금 테스트와 독립, 오래된 URL·임의 보상값 거부.

기존 동의 기반 분석 경로를 재사용해 `daily_challenge_start/result/reward` 이벤트를 제안한다. 날짜·선택 버전·트랙·기체·난이도·조건 ID·성공/실패·지급 여부만 보내고 프로필/영수증은 보내지 않는다. 결과 이벤트는 세션당 한 번, reward 이벤트는 저장 성공으로 실제 지급됐을 때만 보낸다. 순위표·연속 출석 보상은 별도 기획이다.
