# 오늘의 도전 — 확정 계약

확정: 2026-10-11. 구현 브랜치: `feat/daily-challenge`. main 머지·배포는 사용자 요청 후 진행한다.

## 사용자 결정

- 첫 성공 보상 **150P**, 하루 한 번만 지급.
- 기본 주행 조건 하나를 매일 순환: **부스트 3회 → 안전 통과 3회 → 드리프트 1회**.
- 재도전은 자유. 하루 최고 성공 기록 한 칸을 갱신한다.
- 목표를 채우고 모든 랩을 제한시간 안에 완주해야 성공한다. 실패·중도 포기는 보상과 최고 기록을 남기지 않는다.

## 날짜·조건·주행 규칙

한국 시간(KST) 자정에 교체한다. 날짜 키는 `YYYY-MM-DD`이며 UTC 시각에 9시간을 더해 구한다. 날짜 시드에서 트랙·기체·난이도·환경·비·장애물 배치를 결정한다. 목표 종류는 날짜 일수 % 3으로 순환한다. 같은 빌드의 같은 날짜에는 모든 재도전에서 같은 조건과 배치를 쓴다.

첫 공개 후보는 분기·코너·장애물이 있는 네온 트랙 6개: ARENA RING, BLOCK SPRINT, COIL FOUNDRY, GRIDWORKS, VICTORY LOOP, WINDOW RUN. 난이도는 쉬움/보통, 트랙의 기본 랩 수를 쓴다. 기체는 CATAMARAN, DR-01, HALO, HAMMERHEAD, NEEDLE 중 하나를 기본 성능으로 대여한다. 구매·해금·업그레이드 여부와 무관하며 장착 기체를 바꾸지 않는다.

전용 타임어택이다. 집중 모드와 경쟁용 소모 아이템은 사용하지 않는다. 코스 아이템·각성·패링·드리프트는 평소대로 쓴다. 일반 캠페인 통과·별·최고 기록·고스트·일반 완주 보상·충돌 포인트 차감은 저장하지 않는다. 충돌과 코스 이탈은 주행 통계에만 남는다. 일반 주행 물리와 트랙 revision은 바꾸지 않는다.

| 목표 | 집계 기준 |
| --- | --- |
| 부스트 3회 | 실제 부스트 발동 횟수 `boostUses`. 키를 누르기만 하거나 충전 부족으로 발동하지 않은 경우 제외. |
| 안전 통과 3회 | 기존 주행 모델의 장애물 안전 통과 `obstaclesPassed`(고도 장애물·차단 통로·지뢰 구간·점프 착지). |
| 드리프트 1회 | 충돌 없이 종료한 1단계 이상 드리프트. 부스트가 꽉 차 있어도 획득 자격이 있으면 집계. 취소·0단계 제외. |

집계는 물리 스텝마다 관찰하므로 렌더 프레임 사이의 드리프트 종료도 놓치지 않는다. 일시정지는 집계를 진행하지 않으며 재시작 시 0으로 초기화한다.

자정을 넘겨 이미 출발한 주행은 출발 날짜의 조건·보상을 유지한다. 준비 화면에서 자정이 지나면 시작 전에 새 날짜의 도전을 다시 준비한다. 종료 후 재도전도 새 날짜 기준이다. 기기 시계를 기준으로 하는 로컬 기능이며 서버 날짜 검증·온라인 순위표는 포함하지 않는다.

## 진입과 화면

격납고 주요 진행 버튼 위에 오늘의 도전 카드: 트랙·대여 기체·난이도·목표·150P/보상 수령 상태·오늘 최고 기록·다음 교체까지 남은 시간·도전하기.

진입 해시: **`#drive?daily=1`**. 다른 track/mode/challenge/test/zone 파라미터가 붙어도 오늘의 정식 명세로 진입한다. 미해금 트랙도 오늘의 도전에 한해 진입할 수 있다. 돌아가기 목적지는 격납고다.

주행 HUD는 속도계 영역에 `오늘의 도전 · 부스트 1/3`처럼 작게 표시한다. 목표를 채우면 체크와 색으로 알린다. 기존 결과 화면에는 목표 달성 여부·성공/미완료·오늘 최고 기록·신기록·이번 지급 포인트·이미 받은 보상 안내를 표시한다. 저장 실패 시 결과 화면에서 재시도할 수 있다.

## 상태·저장 API

`src/game/progression/dailyChallenge.ts`는 DOM·저장소에 의존하지 않는 순수 모듈이다.

```ts
type DailyGoalId = 'boost' | 'safe-pass' | 'drift';
interface DailyChallenge {
  dateKey: string; challengeId: string; seed: number;
  trackId: string; trackRevision: number; craftId: string;
  challenge: RaceChallengeId; mode: 'time-attack'; laps: number;
  environmentId: RaceEnvironmentId; rainIntensity: RainIntensity;
  rewardPoints: number; goal: { id: DailyGoalId; target: number };
}
interface DailyCounters { boost: number; safePass: number; drift: number }
interface DailyRunRecord {
  challengeId: string; raceId: string; total: number; laps: number[];
  recordedAt: string; controlMode: 'touch' | 'keyboard' | 'gamepad';
}
interface DailySnapshot {
  challenge: DailyChallenge;
  status: 'ready' | 'running' | 'success' | 'failed';
  current: number; target: number; done: boolean;
  best: DailyRunRecord | null; rewardClaimed: boolean;
  nextDayInSeconds: number;
}
interface DailyResultInput {
  challenge: DailyChallenge; raceId: string; laps: number[];
  counters: DailyCounters; disqualified: boolean;
  recordedAt: string; controlMode: DailyRunRecord['controlMode'];
}
interface DailySettlement {
  success: boolean; awarded: number; rewardClaimed: boolean;
  isNewBest: boolean; best: DailyRunRecord | null;
}
interface DailyProgress {
  bests: Record<string, DailyRunRecord>;
  receipts: Record<string, string>; // 날짜 → 첫 성공 raceId
}

dailyDateKey(nowMs?: number): string;
dailyChallengeFor(dateKey: string): DailyChallenge;
dailyObstacleRandom(challenge: DailyChallenge): () => number;
dailyGoalCurrent(challenge: DailyChallenge, counters: DailyCounters): number;
dailySnapshot(profile: {daily: DailyProgress}, challenge: DailyChallenge, nowMs?: number): DailySnapshot;
dailyResultSucceeded(input: DailyResultInput): boolean;
settleDailyResult(current: DailyProgress, input: DailyResultInput): {daily: DailyProgress; settlement: DailySettlement};
validateDailyProgress(value: unknown): DailyProgress;
emptyDailyProgress(): DailyProgress;
dailyChallengeHash(): string;
```

상수 export: `DAILY_REWARD`, `DAILY_SELECTION_VERSION`, `DAILY_TRACK_IDS`, `DAILY_CRAFT_IDS`.

`RaceRules.daily?: DailyChallenge`로 세션을 시작한다. `RaceSnapshot.daily`는 `{challenge: DailyChallenge, counters: DailyCounters} | null`이다. 화면은 이 값과 저장 프로필의 `dailySnapshot()`을 합쳐 `DailySnapshot`을 만들며, 결과는 저장 트랜잭션의 `DailySettlement`로 확정한다. 주행 도중 `done`은 목표 달성을 뜻하고 성공은 완주 판정까지 포함한다.

`ProgressStore.settleDaily(input: DailyResultInput): Promise<DailySettlement>`가 IndexedDB read/write 트랜잭션 안에서 최신 프로필을 읽고 지갑·최고 기록·지급 영수증을 함께 저장한다. `ProgressCommand`에도 `{kind:'daily-result', input}`을 지원한다. 동시에 두 탭에서 성공하거나 같은 결과를 재시도해도 날짜 영수증이 있는 경우 추가 지급하지 않는다. 저장 실패 시 지갑과 영수증 모두 미반영이며 재시도 가능하다.

`Progress.daily`는 기존 저장 데이터에 없으면 빈 값으로 이행한다. 최고 기록 상세는 최근 30일만 보관하고, 날짜별 지급 영수증은 제거하지 않는다. 트랙 revision·주행 규칙·기체 성능·선택 버전은 `challengeId`에 포함한다. 같은 날짜에 규칙이 바뀌면 비교 가능한 최고 기록만 표시하고 영수증은 유지해 150P를 다시 지급하지 않는다. 더 느린 성공·실패는 최고 기록을 덮지 않는다.

화면 export(`src/dailyChallengeView.ts`):

```ts
dailyGoalLabel(id: DailyGoalId): string;
mountDailyChallengeCard(host: HTMLElement, store: ProgressStore): () => void;
renderDailyHud(host: HTMLElement, snapshot: DailySnapshot | null): void;
renderDailySettlement(host: HTMLElement, snapshot: DailySnapshot, settlement: DailySettlement, balance: number): void;
```

## 분석·검증

기존 GA4 `level_start`/`level_end`에 `daily_date`·`daily_goal`을 추가한다. 완주는 목표와 제한시간 판정을 모두 통과한 경우 성공으로 기록한다. 첫 지급 트랜잭션 성공 후에만 `daily_reward`를 보내며 `reward_points:150`을 포함한다. 분석 전송은 로컬 보상 저장을 막지 않는다.

회귀 테스트: KST 자정·윤일·잘못된 날짜, 366일 선택·목표 순환, 시드 재현, 목표 세 종류·완주/실격, 첫 성공 150P·재도전·동점·더 빠른 기록, 30일 상세 정리/영수증 보존, 기존 프로필 이행, 캠페인 기록 격리, 명세 변조 거부, 두 저장소 동시 정산·저장 실패 후 재시도, 꽉 찬 게이지의 드리프트 집계, 실제 세션 장애물 재현·재시작·일시정지.

2026-10-11 검증: 전체 테스트 703/703 통과 후 데스크톱·터치 실제 물리 세션 완주 검사를 추가했고, 도전 전용 테스트 13/13을 통과했다. 프로덕션 빌드·타입 검사·`docs:world:check`도 통과했다.

Chrome에서 당일 VICTORY LOOP를 실제 3랩 완주(03:55.860)해 목표 3/3, 첫 성공 +150P, 최고 기록과 격납고 재진입 시 보상 수령 상태를 확인했다. 데스크톱 1280×720, 모바일 세로 360×740 및 가로 844×390/667×375의 카드·HUD·일시정지·결과 배치를 확인했다. 작은 가로 화면 결과는 간격과 기록 크기를 줄이고, 세로 화면은 보상을 먼저 배치해 목표·보상·재도전 버튼이 보인다. 모바일 결과 화면 배치 검증은 저장하지 않는 표시 fixture이며 실기기 터치 완주 검증과 구분한다.

실제 주행 캡처 평균 밝기는 데스크톱 88.54, 모바일 가로 84.59(0–255 기준)로 검은 화면 검사 기준 40 이상이다. 개발 서버 재시작 후 새 페이지 콘솔 오류 0. 캡처는 `output/playwright/daily-*.png`에 저장했다. 실기기 진동·게임패드 검증은 이번 범위에 포함하지 않았다.
