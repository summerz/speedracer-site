# 분기 다양화 — ARENA RING 계약

상태: 로직 및 snapshot export 구현 완료, 시각 연결·화면 검증·머지 전. 기준은 main `20a27ea`(0.19.18), 로직 브랜치는 `feat/branch-diversity-contract`다. 기존 `c9f8617` 구현을 이 기준 위로 가져오고 마린시티 48트랙 구성과 함께 검증한다. 앱 버전은 올리지 않는다.

## 대상과 규칙

4단계의 이번 묶음은 **09 ARENA RING 한 곳의 기존 좌우 분기를 3갈래로 확장**한다. 기존 분기는 실제 경로 길이 약 570/595m였고 입체 코일이 없는 아레나 경로다. 삼거리는 공유 진행도 775~1305m(한 랩 2777m의 약 28~47%)에 놓인다. 첫 코스의 튜토리얼이나 VOLTAGE YARD 점프와 분리해 검증할 수 있다.

| 순서 | 경로 ID | 이름 | 도로 높이 | 주행과 위험 | 실제 길이 |
| --- | --- | --- | --- | --- | --- |
| 왼쪽 | `arena-ring-fork:0` | 인사이드 어택 | 낮음: 기준 도로 높이 | 완만한 S자, 고도 장애물 2개(올리기·내리기) | 577.8m (가운데보다 7.9% 김) |
| 가운데 | `arena-ring-fork:2` | 아레나 크루즈 | 중간: 기준 도로에서 최대 +18m | 가장 완만한 기본 길, 고정된 안전 차선의 길막 1개 | 535.5m (기본 길) |
| 오른쪽 | `arena-ring-fork:1` | 아웃사이드 부스트 | 높음: 기준 도로에서 최대 +36m | 넓은 커브, 위험 장애물 없음, 안전한 부스트 패드 1개 | 543.7m (가운데보다 1.5% 김) |

높이는 도로가 기준 도로의 위쪽 방향으로 솟는 최대 변위다. 세계 Y 좌표나 기체 고도 단수가 아니다. 상승은 갈라진 뒤, 하강은 합류 전에 완만하게 끝낸다. 길이는 형상 적분으로 측정했다. 초안의 왼쪽 단축·오른쪽 +6% 목표는 적용하지 않았다. 조향 부담을 줄이기 위해 오른쪽 굽이를 줄였고, 왼쪽은 낮은 도로에서 고도 대응을 연습하는 길로 둔다. 가운데가 가장 짧고 완만하다. 표의 길이 비율을 보상이나 NPC 속도 배율로 사용하지 않는다.

경로를 고르는 입력은 **좌·중·우 조향만**이다. 도로 높이 선택에 고도 입력을 추가로 요구하지 않는다. 기존 고도 버튼은 선택한 노면을 기준으로 장애물을 피하는 데 사용한다. 새로운 버튼·속도 조건·점프를 추가하지 않는다.

- 공통 입구 60m, 분리/재접합 완충 구간 각각 약 100m. 실제 도로 폭은 유지한다. 공통 입구 끝을 지난 뒤 이번 랩의 경로를 확정한다.
- 선택 규칙: 입구에서 `offset < -0.3 * halfWidth`면 왼쪽, `offset > 0.3 * halfWidth`면 오른쪽, 나머지는 가운데. 경계값도 가운데다. 중립 조향은 가운데로 이어진다. ARENA RING에서는 ±4.2m가 경계다.
- 공통 입구 안에서는 변경할 수 있고, 입구 밖에서는 잠긴다. 다음 랩에서는 다시 고른다. 빠른 부스트/큰 dt로 선택 경계를 넘는 경우에도 같은 규칙을 적용한다.
- 분기 안내는 최소 180m, 속도가 높으면 약 2.5초 앞에서 시작한다. 입구·합류와 완충 구간에는 위험과 아이템을 겹쳐 놓지 않는다.
- 이 분기의 위험 배치는 고정한다. 무작위 배치가 경로 안에 추가 장애물이나 아이템을 넣어 위 표의 성격을 바꾸지 않게 슬롯을 예약한다. 각성 코어 빈도·보유량은 그대로 따른다.
- 고도 장애물은 90m 이상, 서로 다른 대응은 130m 이상 **실제 거리**를 확보한다. 공간이 모자라면 형상을 조정하거나 제작 검증에서 실패시키고 조용히 겹쳐 넣지 않는다. 길막의 안전 차선은 진입 전에 보인다. 부스트 패드는 충분히 분리된 완만한 구간에 둔다.
- 공유 진행도·랩·순위는 기존 규칙을 유지한다. 각 경로의 실제 길이에 따라 진행도를 적분하므로 같은 속도에서 긴 길이 실제로 더 오래 걸린다. 경로별 위험·통과·충돌·경고는 그 경로에만 적용한다.
- NPC는 세 경로를 사용하고 잠긴 선택을 지킨다. 각성 자동 주행은 입구에서 선택 가능한 기본 가운데 길을 목표로 하고, 이미 확정된 경로에서는 그 길을 따라간다. 기존 모바일/데스크톱 난이도 배율은 올리지 않는다.

## 화면 데이터 계약

분기 안내 Module을 `src/game/track/forkCue.ts`에 두고 선택·단위·표시 정보를 모은다. 화면은 `RaceSnapshot.forkCue`를 읽고, 월드 표지에는 아래 `forkRouteCues()`를 사용한다. 기존 `RaceSnapshot.fork`는 연결 전까지 유지한다. **아래 이름/타입은 실제 export이며 화면에서 바로 import할 수 있다.**

```ts
export type ForkChoice = 'left' | 'center' | 'right' | 'lower' | 'upper';
export type ForkRoadHeight = 'low' | 'middle' | 'high' | 'variable';
export type ForkHazard = 'height' | 'corridor';

export interface ForkRouteCue {
  readonly id: string;
  readonly name: string;
  readonly choice: ForkChoice;
  readonly roadHeight: ForkRoadHeight;
  readonly hazards: readonly ForkHazard[];
  readonly features: readonly string[];
  readonly length: number; // 분기~합류의 실제 m
}

export interface ForkCue {
  readonly id: string; // TrackFork.id
  readonly kind: 'horizontal' | 'vertical';
  readonly phase: 'approach' | 'choice' | 'route';
  readonly routes: readonly ForkRouteCue[];
  readonly defaultRouteId: string;
  readonly previewRouteId: string; // 현재 입력으로 고를 경로 / 확정 후 확정 경로
  readonly selectedRouteId: string | null; // 입구 끝을 지난 뒤만 값이 있음
  readonly distance: number; // approach: 입구 시작, choice: 선택 마감, route: 합류 끝까지 실제 m
}

export interface ForkCuePose {
  readonly distance: number; // 누적 공유 진행도
  readonly offset: number; // 노면 기준 횡방향 m
  readonly altitudeLevel: number; // 기존 0-based 단수, 기존 상하 2갈래 호환용
  readonly routeId?: string | null;
  readonly speed: number; // m/s, 안내 시작 범위 계산용
}

export function forkRouteCues(fork: TrackFork): readonly ForkRouteCue[];
export function readForkCue(track: Track, pose: ForkCuePose): ForkCue | null;
// RaceSnapshot.forkCue: ForkCue | null
```

`readForkCue`는 DOM·저장·선택 변경 부작용이 없다. 이번에는 새 metadata가 있는 ARENA RING 분기에만 값을 반환하고, 기존 2갈래는 기존 fork 안내를 유지한다. 안내 범위 밖과 합류 후에는 null, 거리값은 음수가 되지 않는다. 일시정지 중에는 주행 상태가 멈추므로 안내도 변하지 않는다. routes는 주행 방향에서 보이는 **왼쪽→가운데→오른쪽** 순서다(기존 상하 분기로 연결을 확장할 때는 아래→위). 선택은 배열 인덱스나 이름 대신 ID로 비교한다. 기존 좌/우 ID를 보존하므로 ARENA RING 배열 순서는 `:0, :2, :1`이다.

`hazards`는 실제 배치된 위험의 종류다. 빈 배열은 위험 장애물 없음이다. features에는 기존 경로 특징과 연속 가속/부스트 패드 같은 주행 특성을 담는다. 아이콘·색·표시 문구는 Claude가 정한다. 위험 차이를 색 하나로만 구분하지 않도록 방향·높이·위험 아이콘을 함께 쓸 수 있다.

도로·난간·차선·PIP·경로 강조는 기존 `roadPaths(track)`와 `track.sample(d, frame, routeId)`를 사용한다. `TrackFork.routes`는 2개 고정 tuple에서 readonly 배열로 넓힌다. 새 3갈래의 각 `BranchRoute`에 표시 metadata를 넣고, 기존 2갈래의 선택·형상은 유지한다. 정점·프레임이나 별도 월드 좌표 배열은 HUD 계약에 복제하지 않는다.

`start/end/mouthEnd/mergeStart`는 한 랩의 공유 진행도, `length/distance`는 실제 m다. 입구와 출구에서는 세 경로의 위치·접선·노면 방향이 일치한다. 도로 높이는 노면의 형상 차이이고, HUD의 기체 고도 단수와 별도로 표시한다. roadHeight만으로 ↑ 입력이 필요하다고 해석하지 않는다. 기존 vertical 분기의 단수 안내는 기존 `fork.level`을 사용하며, 새 3갈래에는 적용하지 않는다.

## 편집 분담과 연결 순서

Codex:

- `trackBranches.ts`: 세 경로 생성, 기본 경로, 선택 잠금, 물리 거리, 이웃 경로끼리 입구·합류 경계 처리. 기존 `routes[1-side]` 형태를 제거한다.
- `trackCatalog.ts`: ARENA RING 제작 recipe/revision, 경로별 고정 위험 계획. 고정 위험 배치 Module과 `obstacleLayout.ts`의 예약 처리.
- `createDrivingModel.ts`, `createRaceSession.ts`: 경계 통과 선택, NPC, 각성 자동 주행. `forkCue.ts`와 `createRace.ts`의 snapshot 타입/값 연결만 최소 수정.
- 계약·카탈로그·위험 문서와 판정 검증. 앱 버전은 올리지 않는다.

Claude:

- `createTrack.ts`의 **createTrackVisual 함수 본문**: 3칸 표지, 선택 방향/높이/위험 아이콘, 경로 식별과 기존 도로 표시. 필요하면 새 표시 Module로 분리한다.
  - 현재 표지는 화살표 2개와 2칸 좌표를 고정 사용한다. `fork.routes` 순서에 맞춰 왼쪽·가운데·오른쪽 3칸으로 바꿔야 한다. 이 시각 연결 전에는 세 번째 경로 문구가 표지 범위를 벗어난다.
- `raceApp.ts`/CSS: `forkCue`의 3경로 안내와 선택 강조. PIP의 경로 강조가 세 경로 모두 보이는지 확인.
- `createDistrictScenery.ts`와 `createSkyTraffic.ts`의 배경 장식은 Claude가 맡는다. Codex의 분기 로직에서는 두 파일을 수정하지 않는다.

Codex의 로직 커밋과 실제 export가 준비되면 해시를 보내고, Claude가 그 위에 시각 연결을 한다. 같은 파일 createTrack.ts는 Codex가 Track 타입 또는 생성 쪽이 필요한 경우에만, Claude가 createTrackVisual 본문을 맡는다. createRace.ts는 Codex snapshot 추가 외 시각 연결을 피하고, Claude의 scenery 호출 변경과 겹칠 경우 미리 알린다. 머지·배포와 로드맵 완료 표시는 사용자가 요청할 때 한다.

## 완료 검증

- 기존 2갈래 전 코스 및 VOLTAGE YARD 점프: 선택·ID·길이·진입/합류·성공/실패의 회귀 검증.
- ARENA RING: 세 경로 입구/합류의 위치·접선·노면 연속성, 이웃 도로 경계 전진 방향, 갈라진 뒤 도로 폭/상호 간격/도시 바닥 여유, 실제 거리 역변환 검증.
- 중립 가운데, 좌우 경계값, 선택 변경/잠금, 랩 재선택, 큰 dt 경계 통과, 각성 진입, 세 경로 NPC 완주 검증.
- 고정 위험 개수·종류, 예약 구간, 안전 차선·고도 통과, 다른 경로와의 충돌/경고 격리, 난이도별 추가 무작위 배치 차단 검증.
- 기본 기체와 빠른 기체로 모든 길 완주. 가운데 길의 제한시간·충돌 부담이 기존보다 악화되지 않는지 확인하고 필요하면 수치를 조정한다.
- 저품질/고품질에 동일한 선택·위험이 적용되는지, 데스크톱/모바일에서 진입이 읽히고 가운데 기본 선택이 가능한지 화면 검증. `npm run docs:world:check`, typecheck, 관련 테스트, 전체 테스트와 build.

전체 4단계 완료를 뜻하지 않는다. 이번 검증이 끝나면 분기 다양화 항목의 첫 트랙으로 기록한다.

## 로직 검증 기록

최초 구현 `c9f8617`: 분기·안내 관련 60개 및 전체 562개 테스트 통과. 기본 Vanguard와 최고속도형 Needle로 세 난이도·세 경로를 일반 AI 입력만으로 충돌/코스 이탈 없이 통과했다. 고정 위험의 무작위 배치 보존, 세 경로 선택/잠금/재선택, 각성 진입/잠긴 경로 유지, 기존 두 갈래의 도로 경계 연속성을 확인했다.

2026-10-10 최신 main `20a27ea` 통합: 분기·배치 관련 73개, 전체 593개 테스트 통과. `npm run build`(typecheck 포함), `npm run docs:world:check`, `git diff --check` 통과. 마린시티 16트랙을 포함한 48트랙과 함께 검증했고, 마린시티 대형 랜드마크의 도로 여유는 크기에 비례하도록 늘렸다(3.1배 구조물: 42m → 130.2m). 저품질/고품질·데스크톱/모바일 화면 검증은 Claude의 시각 연결 뒤 수행한다.
