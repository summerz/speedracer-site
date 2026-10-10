# 설계된 연습 주행 — 로직·화면 연결 계약

3단계 담당: Codex는 단계 조건·고정 배치·입력·정지·저장·집계를, Claude는 안내 카드·대상 링·완료 화면을 맡는다. 카드는 속도계 아래 상단 고정이며 키보드/터치 문구는 화면에서 선택한다. 연습은 일반 레이스와 별도 세션이다.

## 공개 데이터와 함수

`src/game/driving/drivingTutorial.ts`는 DOM 없는 모듈이다. 아래 타입은 모두 export한다.

```ts
type TutorialStepId = 'throttle' | 'steer' | 'altitude' | 'boost'
  | 'brake' | 'hazard' | 'near-miss';
type TutorialMode = 'first-run' | 'practice';
type TutorialOutcome = 'completed' | 'skipped';
type TutorialPhase = 'intro' | 'await' | 'act' | 'demo' | 'freeze' | 'done';
interface TutorialTarget {
  kind: 'hazard' | 'near-miss';
  distance: number; offset: number; altitude: number; altitudeLevel: number;
  worldPosition: { x: number; y: number; z: number };
}
interface TutorialSnapshot {
  step: TutorialStepId; stepId: TutorialStepId; // 같은 값
  index: number; total: number;               // 0부터 시작, total=7
  phase: TutorialPhase;
  checks: { id: string; done: boolean }[];
  progress: number;                          // 0~1
  nextIn?: number;                           // done에서 남은 초
  frozen: boolean; inputLocked: boolean;
  expectedCheck?: string;                    // await에서 필요한 check id
  target?: TutorialTarget;                   // hazard/near-miss 대상
}
interface TutorialStatus {
  mode: TutorialMode; outcome: TutorialOutcome | null;
  completedSteps: number; skippedSteps: number;
  steps: { id: TutorialStepId; result: 'pending' | 'completed' | 'skipped' }[];
}
interface TutorialFrame {
  phase: RacePhase; speed: number; steer: number; brake: boolean; distance: number;
  altitudeLevel: number; boosting: boolean; obstaclesPassed: number;
  collisions: number; nearMisses: number;
  altitudeChanged?: boolean; atTarget?: boolean;
}
interface TutorialAction {
  steer: number; brake: boolean; boost: boolean; requestedAltitudeLevel?: number;
}
createDrivingTutorial(options: {
  mode: TutorialMode; onFinish?: (status: TutorialStatus) => void;
}): {
  snapshot(): TutorialSnapshot | null;
  status(): TutorialStatus;
  speedScale(): number;
  setTargets(targets: Partial<Record<'hazard' | 'near-miss', TutorialTarget>>): void;
  update(deltaSeconds: number, frame: TutorialFrame): void;
  acceptInput(action: TutorialAction, frame: TutorialFrame): boolean;
  continue(): boolean;
  skip(): void;
  skipAll(): void;
  onChange(listener: (snapshot: TutorialSnapshot | null) => void): () => void;
}
```

`RaceSnapshot.tutorial`은 카드에 그대로 전달한다. `RaceSnapshot.tutorialStatus`는 세션 종료 후에도 7개 단계 결과를 유지한다. `outcome !== null`이 종료 신호이며 `phase === 'finished'`와 함께 연습 완료 화면을 표시한다. `completed`는 전 단계 수행, `skipped`는 하나 이상 건너뜀이다. 전체 안내 끄기도 연습을 종료한다. 일반 결과 화면 대신 완료 화면을 띄우는 분기는 Claude가 `raceApp.ts`에 연결한다.

`Race.continueTutorial(): boolean`, `Race.skipTutorial(): void`, `Race.skipAllTutorial(): void`를 사용한다. 계속은 intro/freeze에서만 효과가 있고 일시정지 중에는 동작하지 않는다. 반환값은 전환 성공 여부다. Enter와 게임패드 A는 계속에 연결되어 있으며 Esc는 기존 일시정지다. 터치 카드 탭은 Claude가 계속에 연결한다. await는 계속 버튼이 아닌 요청한 실제 조작으로 재개한다.

`raceApp.ts`의 로컬 진입점 `startFirstCourse(): void`는 연습을 종료하고 첫 캠페인 코스의 일반 타임어택을 시작한다(다른 코스에서 연습에 들어왔다면 첫 코스로 이동). `restartTutorialPractice(): void`는 첫 코스의 새 연습 세션을 즉시 시작한다. Claude는 완료 화면의 두 버튼에 이 함수를 연결한다. 동일한 진입점에 window 이벤트 `speedracer:tutorial-first-course`, `speedracer:tutorial-practice`도 연결되어 있다.

`onChange()`는 등록 즉시 현재 값을 보내며 반환한 함수로 해제한다. snapshot/status는 배열·대상 좌표까지 복사한다. 주행 시도마다 새 컨트롤러를 만든다.

## 단계 흐름과 시간

| phase | 세계 정지 | 조작 | 전환 |
| --- | --- | --- | --- |
| intro | 예 | 잠금 | 설명을 읽고 계속 |
| await | 예 | 필요한 입력 대기 | 올바른 입력 시작 시 act |
| act | 아니오 | 해당 단계 조작만 허용; hazard는 자동 통과 | 체크 수행 후 done 또는 다음 체크 await |
| demo | 아니오 | 잠금·자동 주행 | hazard 접근 후 await / 니어미스 가장 가까운 지점에서 freeze |
| freeze | 예 | 잠금 | 니어미스 설명 후 계속 → demo |
| done | 예 | 잠금 | 1.2초 후 다음 intro 또는 세션 종료 |

세계 정지 중 주행 시간·부스트 소모·물리·장애물 시계·날씨와 주행 카메라 보간은 진행하지 않는다. done의 1.2초는 별도 안내 시계로 센다. 일시정지·카운트다운 중에는 안내 시계도 멈춘다. `inputLocked: false`인 await라도 세계는 멈춰 있고 필요한 입력만 재개를 허용한다.

연습 속도 상한은 일반/부스트 모두 원래의 28%다(`TUTORIAL_SPEED_SCALE = 0.28`). 가속·조향 입력 값은 유지한다. 연습 종료 후 일반 첫 코스는 새 세션으로 정상 속도로 시작한다. 완료 표시는 `TUTORIAL_DONE_SECONDS = 1.2` 동안 **좋아요 ✓**를 쓰며 카운트다운은 표시하지 않는다.

| step | check id | 완료 조건 |
| --- | --- | --- |
| throttle | auto | 계속 후 자동 가속 2초, 실제 속도 5m/s 초과 |
| steer | left, right | 각 방향 입력 강도 0.2 초과를 0.12초 유지; 사이에 다시 정지 |
| altitude | up, down | 실제 한 단계 올리기·내리기; 사이에 다시 정지 |
| boost | on, alt-change | 실제 부스트 발동 후 정지; 부스트를 유지하며 고도를 실제 변경 |
| brake | on | 브레이크 0.15초 유지 |
| hazard | pass | 고정 장애물 앞까지 자동 접근 후 정지; 안전 고도로 입력하고 충돌 없이 실제 통과 |
| near-miss | once | 조작 잠금 자동 접근 → 최근접에서 정지 설명 → 계속 후 실제 니어미스 1회 |

조작 체크는 재개 후 최소 0.45초 보여주고 다음 체크 대기로 바뀐다. 끝 고도에서 같은 방향으로 누르면 재개하지 않는다. boost의 alt-change는 어느 방향이든 실제 변경이면 된다. 이전 단계의 입력·통과·니어미스는 다음 단계를 미리 완료하지 않는다. 현재 단계 건너뛰기는 done 전환을 거치고 전체 끄기는 즉시 종료한다.

## 고정 코스와 대상 좌표

`src/game/driving/scriptedTutorial.ts`의 export:

```ts
const TUTORIAL_HAZARD_DISTANCE = 240;
const TUTORIAL_NEAR_MISS_DISTANCE = 400;
interface TutorialHeightRequest { lift: number; targetAltitudeLevel?: number }
createTutorialTrack(base: Track): Track;
createTutorialRuntime(
  track: Track, session: ReturnType<typeof createRaceSession>,
  tutorial: ReturnType<typeof createDrivingTutorial>,
): {
  step(dt: number, input: DrivingInput, requests?: readonly TutorialHeightRequest[]): {
    input: DrivingInput; altitudeChanged: boolean; simulationDelta: number;
  };
};
```

첫 캠페인 코스의 도로 형태를 유지하고 무작위 분기·지뢰·위험 아크·아이템·각성 코어를 제거한다. 240m에 깊이 12m인 고도 올리기 장애물(안전 고도 1), 400m에 깊이 12m·안전 통로 폭 8m인 니어미스 대상 1개만 둔다. 난이도와 무작위 시드에 관계없이 같은 배치다. 앞의 다섯 단계에서는 176.8m 이상 진행하지 않도록 해 장애물을 먼저 통과하지 않는다. hazard 접근은 211.8m에서 멈춘다.

니어미스는 기체 중심을 통로 중앙에서 오른쪽 1.8m로 자동 유도한다. 기체 반폭 1.6m를 포함해 벽과 0.6m 간격이 남는다. 400m에서 정확히 멈추고 재개 후 실제 물리 통과 판정이 니어미스를 발생시킨다. 충돌·니어미스 횟수를 인위적으로 늘리지 않는다.

`target.worldPosition`은 hazard의 안전 통과 중앙, near-miss의 **오른쪽 벽 안쪽 경계(offset=4m)** 위치다. 니어미스 기체 중심 위치와 다르다. 기체별 고도 프로필의 1단계를 쓰며 첫 코스 프레임으로 월드 좌표를 계산한다. Claude가 createRace에서 이를 화면 좌표로 투영해 `tutorialTargetScreen: { x, y, visible }`을 추가한다. Codex는 이 필드·투영·링 표시를 구현하지 않는다.

## 연습 종료와 저장 분리

처음 실행 여부는 `tutorialProgress.ts`의 `speedracer:tutorial:v1`에 저장한다. 미완료 상태로 떠나면 다음 첫 코스 진입에 재시도하며 완료/안내 끄기는 저장한다. 저장 실패는 게임을 중단하지 않고 현재 화면의 메모리에 유지한다.

일시정지 메뉴의 연습은 어느 코스·모드에서 들어와도 첫 코스 + 같은 배치를 사용한다. 첫 실행도 이 별도 연습을 사용하며 NPC·장착 아이템·각성·회수 조작은 비활성이다. 제한시간·랩 완주가 아닌 7단계 종료로 `finishPractice(): boolean`을 호출해 종료한다. 이 함수는 practice 규칙 + running 상태에서만 유효하며 레이스 기록을 저장하지 않는다.

연습은 최고 기록·고스트·리플레이·보상·캠페인 진행·소모 아이템에 영향을 주지 않는다. `tutorialStatus.outcome`과 모든 steps를 완료 화면에서 사용하고 일반 주행으로 이동하거나 다시 연습한다.

## GA4 검증

기존 동의 기반 analytics에 `tutorial_begin`, `tutorial_step`, `tutorial_complete`를 추가한다. 단계별 completed/skipped 요약으로 집계하므로 마지막 단계나 전체 끄기를 중간 프레임 없이 관측해도 단계 이벤트는 한 번씩 기록된다. 중도 이탈은 `race_quit`의 `tutorial_outcome: incomplete`다.

연습 세션은 `practice: true`, `tutorial_mode: first-run | practice`다. 연습의 level_end는 실제 첫 코스 완주로 집계하지 않는다. 일반 첫 코스는 `practice: false`, `tutorial_mode: off`, `tutorial_history: unseen | completed | skipped`로 이전 안내 결과를 남긴다. 완주율 비교는 실제 코스의 level_start를 분모로, 성공 level_end를 분자로 삼고 track_id·race_mode·difficulty·control_type을 동일하게 맞춘 뒤 tutorial_history별로 비교한다. 동의 전 이벤트는 저장하거나 소급 전송하지 않는다.

검증: 실제 기체 5종 × 30/60/120fps에서 7단계 완료·최근접 정지·충돌 없는 실제 니어미스·기록 저장 없음, 정지 중 세션 상태/부스트 시계 유지, 일시정지·입력 조건·건너뛰기·저장 실패·GA4 중복 방지를 테스트한다. 카드·링·완료 화면의 시각 검증은 Claude 연결 후 수행한다.
