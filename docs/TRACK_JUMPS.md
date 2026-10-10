# 끊긴 도로 점프 — 로직·시각 계약

4단계 첫 트랙은 06 VOLTAGE YARD의 위쪽 `송전 우회로`(`voltage-yard-fork:1`)다. 아래쪽 경로는 그대로 통과할 수 있다. 점프는 매 랩 같은 곳에 고정하고, 해당 트랙의 기록 제작 버전만 6 → 7로 올린다. 앱 버전과 머지는 시각 연결 후 사용자 요청 때 처리한다.

마린시티 재설계에서는 48 SURFACE RUSH의 오른쪽 `라군 점프`(`surface-rush-fork:1`, 점프 ID `surface-rush-drop`)에도 같은 규칙을 적용한다. 왼쪽 `수면 아치`는 도로가 이어지는 선택지다. 이 트랙은 고도 4단계 중 최고 3단계에서 출발해 0단계로 착지한다. 마린 트랙 revision은 2이며 [마린 형상 재설계](MARINE_TRACK_REDESIGN.md)에 전수 감사와 기체별 점프 검증을 기록한다.

## 주행 규칙

- 도로 끝 100m 전부터 높은 고도(이 트랙의 1단계)를 안내한다. 실제 진입 고도가 최고 고도 − 0.6m 이상이면 출발 성공이다.
- 약 61m의 공중 경로에서 기존 고도 조작으로 낮은 고도(0단계)를 선택한다. 도로가 다시 시작하는 지점부터 실제 거리 50m의 착지 여유가 있다. 그 끝에서 최저 고도 + 0.75m 이하여야 한다.
- 출발·착지 때 기체 반폭 1.6m를 도로 안에 둔다. 선택한 고도 번호 대신 보간 중인 실제 고도·횡위치를 검사한다.
- 새 점프 키, 최소 속도, 부스트 요구는 없다. 브레이크로 속도를 낮춰도 통과한다.
- 실패는 점프·랩당 한 번만 기존 장애물 충돌·감점과 가벼운 속도 손실(기본 기체 약 20%)을 적용한다. 출발 실패 뒤 착지에서 다시 감점하지 않고, 체크포인트 복구로 같은 통과를 중복 집계하지 않는다. 실패해도 진행도를 되돌리지 않는다.
- 실패 알림은 `DrivingState.notice = 'jump-missed'`다. 전기선의 `height-collision`과 구분해 문구·소리·진동을 연결한다.
- 성공은 `jumpsPassed`와 기존 클린 연속·장애물 통과에, 실패는 `jumpsMissed`와 기존 충돌·감점에 집계한다. 각성 동안 판정을 보호하며, NPC와 각성 자동 주행은 진입/공중/착지 고도를 따라간다.
- 안내 시작부터 착지 여유 끝까지 무작위 장애물·부스트 아이템의 부피가 겹치지 않도록 배치 슬롯을 예약한다. 각성 코어는 원래부터 공통 도로에만 놓인다.

## 경로·단위

`approachStart`, `start`, `end`, `landingEnd`, `rejoinEnd`는 **한 랩의 공유 진행도**다. 렌더러는 `track.sample(d, frame, jump.routeId)`를 그대로 사용한다. `start..end`에서 노면·난간·차선을 생략하고, `end..landingEnd`를 착지 구간으로 표시한다. `landingEnd..rejoinEnd`는 낮아진 도로가 원래 경로로 부드럽게 복귀하는 구간이다.

기존 호버 물리를 유지하기 위해 도로가 없는 동안에도 가상의 비행 기준선을 사용한다. `sample`은 원래 경로보다 착지면을 세계 Y축으로 12m 낮추고 끝단의 위치·접선·노면이 연속인 완만한 경로를 반환한다. 별도 중력이나 점프 속도는 추가하지 않는다. 하강으로 달라진 실제 경로 길이를 다시 적분·매개화해서 실제 속도, 거리와 두 갈림길의 공통 진행도를 유지한다. `physicalDistance`와 `advanceTrackDistance`를 계속 사용한다. 표시 거리와 착지 여유는 **실제 m**다.

현재는 분기 경로당 점프 한 개만 지원하며 같은 경로에 여러 recipe를 넣으면 오류로 거부한다. 랩 경계와 공통 합류 구간에는 배치하지 않는다.

## 공개 API

`src/game/track/trackJump.ts`:

```ts
interface JumpRecipe {
  readonly id: string;
  readonly branchId: string;
  readonly routeIndex: 0 | 1;
}
interface TrackJump {
  readonly id: string;
  readonly routeId: string;
  readonly approachStart: number;
  readonly start: number;
  readonly end: number;
  readonly landingEnd: number;
  readonly rejoinEnd: number;
  readonly drop: number;
  readonly launchLevel: number;
  readonly landingLevel: number;
}
interface JumpCue {
  readonly jump: TrackJump;
  readonly phase: 'approach' | 'airborne' | 'landing';
  readonly distance: number; // 다음 경계까지의 실제 m
  readonly requiredLevel: number;
}
withTrackJumps(track: Track, recipes?: readonly JumpRecipe[]): Track;
upcomingTrackJump(track: Track, distance: number, routeId?: string | null): JumpCue | null;
jumpPlacementClear(track: Track, distance: number, routeId?: string | null, radius?: number): boolean;
```

`Track.jumps?: readonly TrackJump[]`, `TrackDefinition.jumps?: readonly JumpRecipe[]`. `createCatalogTrack`은 갈림길 → 점프 → 무작위 장애물 순서로 만든다. `RaceSnapshot.jump: JumpCue | null`은 현재 선택 경로의 점프만 노출한다. 안내 범위 밖에는 `null`; 진입은 높은 고도, 공중·착지는 낮은 고도다. `distance`는 각각 출발선/도로 재개점/착지 여유 끝까지의 거리다.

`src/game/driving/jumpPassage.ts`는 DOM 없는 판정 모듈이다:

```ts
interface JumpPose { distance: number; altitude: number; offset: number; routeId?: string | null }
createJumpTracker(track: Track): {
  reset(): void;
  update(from: JumpPose, to: JumpPose, protectedFlight?: boolean): ('landed' | 'missed')[];
};
```

## 작업 경계·검증

Codex는 `createTrack.ts`의 타입/import만 변경한다. Claude는 같은 파일의 `createTrackVisual` 본문과 새 `createTrackJumpVisual.ts`에서 끊김·경고 끝단·민트 착지 패턴을 만들며, `RaceSnapshot.jump`으로 안내를 연결한다. `createRace.ts`의 로직 변경은 snapshot 필드와 이를 채우는 호출만 추가했다. 결과 화면·카메라·스타일은 변경하지 않았다.

자동 검증은 모든 기체 × 30/60/120fps × 일반/부스트/브레이크/저속/NPC/각성 주행, 실제 고도의 출발·착지 판정, 잘못된 경로 무시, 랩별 중복 방지·복구·리셋, 3난이도 무작위 배치 20회, 기존 갈림길의 거리·접합 연속성을 포함한다. 도로 끊김의 시야와 안내 가독성은 Claude 연결 후 화면에서 검증한다.
