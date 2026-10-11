# 패링 확정 계약

확정: 2026-10-11 · 최초 구현: 0.19.25 · 세부 개선: 0.19.26 (`fix/race-polish`)

사용자 결정은 **A(전기 장애물·펄스 지뢰 충격) + B(벽·차단 통로·기체 접촉 완충)**이며, 구매·장착 없이 플레이어의 기본 능력으로 제공한다. 타임어택·경쟁 레이스, 모든 난이도·기체·입력 장치에 같은 규칙을 쓴다. NPC 공격이나 NPC 패링은 추가하지 않는다. 지원 미사일은 기존처럼 플레이어만 사용한다.

## 방어와 접촉 규칙

- 누르는 순간부터 **0.30초** 방어 창, 발동 순간부터 **6.0초** 재사용 대기. 성공·실패 모두 같은 대기 시간을 쓴다. 창 안에서 첫 충격 한 번만 방어한다. 창이 끝날 때 성공하지 못했으면 실패 이벤트를 내며 실패 자체의 벌점은 없다. 경계 시각 0.30초부터는 창 밖이다.
- 실제 피해를 받으면 남아 있는 방어 창과 실패 잔상을 즉시 지운다. 방어 창이 열려 있었다면 실패를 한 번 기록하고, 이미 끝난 시도에는 실패를 더하지 않는다. 피해가 재사용 대기를 초기화하거나 단축하지 않는다.
- 방어하는 충격: `heightObstacles` 전기선, `mineFields` 개별 지뢰, `corridorObstacles` 차단 통로, 낮은 고도의 벽, 경쟁 레이스 기체 접촉. 코스 이탈·복귀·점프 착지 실패·긴 전기 구간 `arcRails`는 방어하지 않는다.
- 성공하면 그 충격의 감속·가속 저하·부스트 손실·충돌 횟수·벌점을 취소한다. 기존 클린 연속과 진행 중 드리프트를 유지한다. 포인트·충전·안전 통과·니어미스·클린 횟수를 추가하지 않는다. 방어한 장애물은 해당 통과의 피격으로 표시해 뒤쪽에서 안전 통과 보상을 중복 지급하지 않는다.
- 벽 접촉에서는 **노면 경계로 위치를 제한하고 바깥 방향 헤딩을 반사하는 처리를 그대로 수행**한다. 통로는 안전 개구부 쪽, 기체는 상대의 반대쪽으로 0.25m 밀며 도로 폭 안으로 제한한다. 이 밀림은 방어 여부와 관계없이 적용한다. 완충은 피해를 막는 기능이며 벽을 관통하거나 경로를 바꾸는 기능이 아니다.
- 벽은 경계보다 **0.5m 안쪽**에서 **0.25초** 연속 주행해야 새 접촉이다. 기체 쌍은 접촉 상자보다 **0.5m 이상** 떨어진 상태가 **0.25초** 이어져야 새 접촉이다. 같은 접촉에서는 첫 충격만 패링 가능하며, 처음에 맞았다가 계속 붙어 있는 상태에서 뒤늦게 방어하는 것도 불가능하다. 이후 충격은 기존 간격(벽 0.5초, 기체 0.7초)으로 정상 피해가 발생한다. 재사용 시간이 돌아와도 붙어 있는 벽에서 반복 방어할 수 없다.
- 전기선·차단 통로는 장애물/랩, 지뢰는 개별 지뢰/랩 단위로 묶는다. 동시에 두 충격을 만나면 첫 충격만 막고 다음 충격은 정상 적용한다.
- 각성의 기존 충돌 무효화가 우선한다. 각성 중 패링 발동은 거부하며 각성 시작 시 열려 있는 창은 성공/실패 없이 취소한다. 복귀·종료도 창과 예고를 취소한다. 재시작은 횟수·이벤트·대기를 모두 초기화한다.
- 준비·카운트다운·일시정지·종료에서는 발동할 수 없다. 일시정지 중 시간은 멈춘다. 집중 모드에서도 방어 창·대기·예고는 **실제 주행 시계의 초**로 계산한다. 설계 튜토리얼에서는 꺼진다. 기본 능력이므로 보조 경기 표시를 만들지 않는다.

## 입력과 화면 분담

| 입력 | 계약 |
| --- | --- |
| 키보드 | **← 또는 →**, keydown 최초 1회만. 자동 반복은 무시. 기존 E도 호환 입력으로 유지. A/D 조향·W 각성·Space 부스트·S 브레이크·↑↓ 고도·기존 아이템 입력과 겹치지 않음. |
| 표준 게임패드 | **R3**(오른쪽 스틱 누름, button 11), 눌림 edge만. RB/RT 부스트·LT 브레이크·LB 집중·Start 일시정지와 겹치지 않음. |
| 터치 | 화면 **오른쪽**, 부스트 위 오른손 호 영역의 버튼을 짧게 탭하면 `Race.useParry(): boolean` 호출. 부스트 오른쪽 각성 코어는 유지. 재사용 진행은 `PARRY_TUNING.cooldownSeconds` 기준. |

사용자 지시로 Codex가 판정·입력·데이터와 화면·이펙트·모바일 버튼을 모두 맡는다.

## 화면 API

`src/game/driving/parry.ts`에서 다음 타입과 `PARRY_TUNING`, `createParryController(enabled?: boolean)`을 export한다. DOM 의존성은 없다.

```ts
export type ParryTargetKind = 'height' | 'mine' | 'corridor' | 'wall' | 'craft';
export interface ParryPosition { x: number; y: number; z: number }
export interface ParryTarget {
  id: string;
  kind: ParryTargetKind;
  worldPosition: ParryPosition | null;
  secondsToImpact: number;
}
export interface ParryEvent {
  id: number;
  outcome: 'success' | 'failure';
  target: ParryTarget | null;
}
export interface ParrySnapshot {
  enabled: boolean;
  phase: 'ready' | 'window' | 'cooldown';
  windowRemaining: number;
  cooldownRemaining: number;
  interrupted: boolean;
  target: ParryTarget | null;
  lastEvent: ParryEvent | null;
  successEventId: number;
  failureEventId: number;
  successes: number;
  failures: number;
}
```

- `DrivingState.parry: ParrySnapshot` → `RaceSnapshot.parry`로 그대로 전달된다. `Race.useParry(): boolean`은 실제 발동 성공 여부이며 키·패드도 같은 함수를 호출한다. session/timeAttack/model도 `useParry(): boolean`을 제공한다.
- `enabled`는 능력 사용 규칙이다. 버튼 사용 가능은 `enabled && phase === 'ready' && state.timeAttack.phase === 'running' && state.awakeningRemaining === 0`으로 판정한다. 성공 후에도 발동부터 6초가 끝날 때까지 cooldown이다. `interrupted`는 실제 피해·복귀·각성·종료로 방어 연출을 지워야 함을 뜻하며 다음 발동/재시작 때 false로 돌아간다.
- `target`은 현재 경로·고도·속도·횡이동으로 예측되는 **0~0.7초 내 첫 충격**이다. 이동 전기선은 도착 시각으로 판정한다. 기체는 상대 속도·헤딩·집중 모드 및 경로의 실제 월드 간격을 고려한다. 정지/완주한 NPC·각성 중인 기체는 제외한다. 입력이나 가속이 바뀌면 예고도 달라지며 자동 회피는 하지 않는다.
- `worldPosition`은 Three.js Vector3가 아닌 월드 좌표 복사본. 도로의 right/up으로 회전·고도를 적용한다. 실제 트랙에서는 위치가 있고, 도로 형상 없는 순수 물리 테스트에서는 null이다. `id`는 통과/접촉 에피소드 식별자이며 기체 대상은 `craft:0:<rivalIndex>:<generation>` 형태다.
- `lastEvent.id`는 성공/실패 공통 단조 증가 번호다. 성공·실패 각각 마지막 번호도 유지하므로 HUD가 저주기로 읽어도 새 이벤트를 감지할 수 있다. 실패 target은 창이 끝날 때의 예고이며 null일 수 있다. 성공 target은 실제 접촉 위치, secondsToImpact=0이다. 재시작 시 모두 0/null로 돌아가므로 화면은 raceId 변경도 함께 초기화한다.

## 기록과 검증

최초 패링 도입(0.19.25) 때 캠페인 **48트랙 revision을 각각 +1**했다(마린 3→4, 빠른 주행 `neon-circuit-v1`→`neon-circuit-v2`). 이번 재사용·피해 규칙 변경도 **48트랙 각각 +1**한다(마린 4→5, 빠른 주행 `neon-circuit-v2`→`neon-circuit-v3`). 이전 revision 기록·고스트와 섞지 않으며 과거 캠페인 통과·해금·지갑은 기존 revision 정책대로 유지한다. 버전과 로드맵 완료 표시는 사용자 요청으로 main에 머지할 때 갱신한다.

검증 범위: 창 경계·늦은 입력·한 번 방어·홀드 중복, 전기선·지뢰·통로·벽·기체, 연속 접촉 남용과 밀림·경계, 다른 경로/고도·이동 장애물 예고, 각성·집중·일시정지·재시작·종료, 보상/드리프트 유지·중복 방지, 30/60/120fps 및 기존 전체 회귀 테스트.

2026-10-11 로직 검증: `tests/parry.test.mjs` 21개 포함 `npm test` **691/691** 통과, `npm run build`·`npm run docs:world:check`·`git diff --check` 통과. 화면 연출·모바일 버튼 배치·실기기 조작 검증은 Claude 연결 후 진행한다.

2026-10-11 세부 개선 검증(`fix/race-polish`): 피해 시 방어 종료·실패 중복 방지·지속 기체 접촉 검사 3개를 추가해 패링 **24/24**, 전체 **694/694** 통과. `npm run build`·`npm run docs:world:check`·`git diff --check` 통과. Chrome에서 좌우 화살표 발동·홀드 중 재발동 없음·모바일 오른쪽 버튼 터치를 확인했다. 실기기 진동과 실제 게임패드 R3는 별도 확인이 필요하다.

참고: [로드맵](QUALITY_ROADMAP.md), [드리프트](DRIFT.md), [상점·지원 미사일](SHOP_PROGRESSION.md).
