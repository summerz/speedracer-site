# 첫 주행 안내 — 로직·화면 연결 계약

3단계 담당: Codex는 안내 조건·저장·주행 연결·집계, Claude는 안내 카드·컨트롤 강조·문구를 맡는다. 카드 위치는 속도계 아래 상단 고정이며, 조작 대상은 링으로 강조한다. 키보드/터치 문구는 화면에서 선택한다.

## 화면에 전달하는 데이터

`src/game/driving/drivingTutorial.ts`는 DOM 없는 모듈이다.

```ts
type TutorialStepId = 'throttle' | 'steer' | 'altitude' | 'boost'
  | 'brake' | 'hazard' | 'near-miss';
type TutorialMode = 'first-run' | 'practice';
type TutorialOutcome = 'completed' | 'skipped';
interface TutorialSnapshot {
  step: TutorialStepId;
  stepId: TutorialStepId; // step과 같은 값
  index: number;         // 0부터 시작
  total: number;         // 7
  phase: 'show' | 'done';
  checks: { id: string; done: boolean }[];
  progress: number;      // 0~1
  nextIn?: number;       // done에서만, 다음 단계까지 남은 초
}
interface TutorialStatus {
  mode: TutorialMode;
  outcome: TutorialOutcome | null;
  completedSteps: number;
  skippedSteps: number;
}
createDrivingTutorial(options: {
  mode: TutorialMode;
  onFinish?: (status: TutorialStatus) => void;
}): {
  snapshot(): TutorialSnapshot | null;
  status(): TutorialStatus;
  update(deltaSeconds: number, frame: TutorialFrame): void;
  speedScale(): number;
  skip(): void;
  skipAll(): void;
  onChange(listener: (snapshot: TutorialSnapshot | null) => void): () => void;
}
```

`RaceSnapshot.tutorial`을 안내 카드 `render()`에 그대로 전달한다. `null`이면 카드를 숨긴다. 주행이 종료되면 안내를 다 못 마쳤어도 이 값은 `null`이고, `RaceSnapshot.tutorialStatus`는 집계 상태를 유지한다. `Race.skipTutorial()`은 현재 단계, `Race.skipAllTutorial()`은 전체 안내를 건너뛴다. UI는 `createRace()` 내부 조건을 다시 계산할 필요가 없다.

`onChange()`는 등록 즉시 현재 상태를 보내고, 상태가 바뀌면 알린다. 반환한 함수로 구독을 해제한다. 각 `snapshot()`은 체크 배열까지 복사하므로 화면에서 수정해도 내부 상태는 바뀌지 않는다. 컨트롤러는 주행 시도마다 새로 만들며, 앱의 재시작·연습 진입도 컨트롤러를 다시 만든다.

## 단계와 완료 조건

| step / stepId | check id | 조건 |
| --- | --- | --- |
| `throttle` | `auto` | 브레이크 없이 움직이는 시간 2초 누적. 자동 가속을 먼저 확인한다. |
| `steer` | `left`, `right` | 각 방향 입력 강도 0.2 초과를 각각 0.12초 유지한다. |
| `altitude` | `up`, `down` | 직접 고도 한 단계 올리기와 내리기를 각각 한다. |
| `boost` | `on`, `alt-change` | 실제 부스트가 발동하고, 부스트 중 직접 고도를 바꾼다. |
| `brake` | `on` | 브레이크를 0.15초 유지한다. |
| `hazard` | `pass` | 앞의 고도 장애물/통과 구간 경고가 보인 뒤 장애물 통과 집계가 증가한다. 그 사이 충돌하면 새 통과를 기다린다. |
| `near-miss` | `once` | 이 단계 진입 이후 실제 니어미스 집계가 한 번 증가한다. |

앞 단계에서 한 조작·니어미스는 뒤 단계를 미리 완료하지 않는다. 각성의 자동 조향·고도 변경도 직접 조작으로 세지 않는다. 니어미스는 어려울 수 있으므로 건너뛰기로 계속 진행할 수 있다.

완료 직후 `phase: 'done'`, `progress: 1`을 1.2초 유지한다(`TUTORIAL_DONE_SECONDS`). 화면은 **좋아요 ✓**를 보여주며 카운트다운 표시를 만들지 않는다. 건너뛴 체크는 `done: false`로 남으므로 화면에서 완료와 건너뛰기를 구분할 수 있다. 현재 단계 건너뛰기도 같은 1.2초 전환을 사용하며, 전체 안내 끄기는 즉시 `null`이 된다. 일시정지·카운트다운·시네마틱 시간에는 조건과 전환 시간이 진행되지 않는다.

`TutorialFrame`은 `phase`, `speed`, `steer`, `brake`, `altitudeLevel`, `boosting`, `obstaclesPassed`, `collisions`, `nearMisses`, `hazardNearby`를 받는다. 선택적인 `altitudeChanged: false`는 자율 주행 등 직접 입력이 아닌 고도 변경을 제외한다. `createRace()`가 이 프레임을 실제 주행 상태로 연결한다.

## 속도와 저장

캠페인 첫 코스(`course.predecessor === null`)에서 안내가 활성화되어 있는 동안 일반 주행·부스트·각성의 속도 상한을 15% 낮춘다(`TUTORIAL_SPEED_SCALE = 0.85`). 가속·조향 민감도는 그대로다. 안내를 완료하거나 끄면 약 1초 동안 상한이 원래 값으로 돌아오며, 주행 모델의 가속으로 속도가 이어진다. 다른 코스의 연습 주행은 속도를 낮추지 않는다.

`src/game/driving/tutorialProgress.ts`:

```ts
createTutorialProgress(storage?: RecordStorage): {
  shouldStart(firstCourse: boolean): boolean;
  outcome(): TutorialOutcome | null;
  finish(outcome: TutorialOutcome): void;
}
```

저장 키는 `speedracer:tutorial:v1`(`TUTORIAL_STORAGE_KEY`), 값은 `{version: 1, outcome: 'completed' | 'skipped'}`다. 안내 종료 이력이 없을 때만 첫 코스에서 자동으로 시작한다. 모든 단계 완료는 `completed`, 하나라도 건너뛰거나 전체 안내를 끄면 `skipped`로 저장한다. 주행 포기·새로고침은 종료 이력을 만들지 않으므로 다음 첫 코스에서 다시 안내한다. 연습에서 완료/끄기도 종료 이력으로 저장한다. 저장소 접근 거부·손상된 값은 주행을 막지 않는다.

## 연습 주행

일시정지 메뉴 `#race-practice`의 **연습 주행**은 현재 코스를 타임어택 방식으로 처음부터 시작하고, 안내 7단계를 다시 제공한다. 개인 최고 기록·고스트·캠페인 별/해금·완주 보상을 저장하지 않는다. 장착 소모품을 소비하지 않고, 랩 제한 시간도 적용하지 않는다. 코스 랩 수를 채우면 종료되며 결과 화면에 연습 기록으로 표시한다. 앱을 나가 캠페인에서 다시 들어오면 일반 주행으로 돌아간다.

## GA4 집계

기존 분석 동의·활성화 조건을 그대로 따른다. 이벤트는 시도마다 중복을 막는다.

- `level_start`: 기존 시작 이벤트. `tutorial_mode: 'off' | 'first-run' | 'practice'`, `practice: boolean`으로 집단을 구분한다.
- `tutorial_begin`: 안내가 있는 실제 주행 시작 시 1회(카운트다운 제외).
- `tutorial_step`: 단계 완료/건너뛰기 1회. `tutorial_step`, `tutorial_step_index`, `skipped`를 보낸다.
- `tutorial_complete`: 안내를 모두 마치거나 끄면 1회. `tutorial_outcome`, `tutorial_completed_steps`, `tutorial_skipped_steps`를 보낸다. 일부 단계만 넘긴 경우에도 최종 outcome은 `skipped`다.
- `level_end`, `race_quit`: 기존 기록과 함께 안내 outcome/완료·건너뛰기 수를 보낸다. 안내가 끝나기 전이면 `tutorial_outcome: 'incomplete'`다.

GA4의 이벤트 순서 퍼널 `level_start → level_end`에서 `practice = false`와 같은 코스·난이도·조작 방식 조건을 맞춘 뒤 `tutorial_mode = first-run / off`의 완주율을 비교한다. `level_end`는 별 획득 실패/시간 초과도 포함하므로 성공 완주율은 추가로 `success = true`를 적용한다. 안내 자체의 이탈 구간은 `tutorial_begin → tutorial_step → tutorial_complete`로 확인한다. `skipped`는 조작 학습 완료와 구분해 해석한다.

## 검증

`tests/tutorial.test.mjs`: 단계 순서·양방향 조작·실제 부스트·충돌 후 재시도·앞선 니어미스 제외·일시정지·건너뛰기·저장 오류·연습 기록 격리·일반/부스트/각성 속도 복귀.

`tests/analytics.test.mjs`: 동의 정책, 시도별 집계에 더해 안내 이벤트 중복 방지·일시정지 중 끄기·포기와 연습 집단 분리.
