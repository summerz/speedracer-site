# TERRACE FLOW 상하 분기 계약

4단계 분기 다양화의 두 번째 트랙은 캠페인 02 TERRACE FLOW다. 아래 길에서는 고도 대응으로 짧은 길을 통과하고, 위 길에서는 높은 전망과 안전한 부스트 기회를 얻는다. 로직은 Codex, 2칸 표지·상하 선택 HUD와 화면 검증은 Claude가 맡는다. main `21d52bc` (0.19.20) 기준 로직 브랜치는 `feat/branch-height-variety`, 상하 HUD 문구와 2칸 표지는 이미 main에 있다. 이 문서의 로직 커밋은 머지·배포·버전 변경을 포함하지 않는다.

## 주행 규칙

- 공통 입구는 60m다. 두 고도 중 낮은 고도(레벨 0)는 아래, 높은 고도(레벨 1)는 위 경로를 고른다. 조향은 선택에 영향을 주지 않는다.
- 입구 끝까지 고도를 바꿔 선택을 수정할 수 있다. 입구가 끝나면 경로가 고정되고, 이후 고도 변경은 같은 도로에서 장애물에 대응한다. 합류 후 선택을 해제하고 다음 랩에서 다시 고른다.
- 중립/경로 미지정 샘플은 아래 길이다. 위 길의 높이는 도로 자체의 상승이며, 기체의 두 고도 단계는 선택한 노면을 기준으로 적용한다.
- 아래 길에는 고정 상승·하강 장애물 2개, 위 길에는 중앙 부스트 패드 1개를 둔다. 난이도·재시작 무작위 배치로 추가 위험이나 각성 코어를 분기 안에 넣지 않는다. 분기 밖의 배치는 기존 규칙을 따른다. 본선의 부스트 링 종류는 유지하며, 위 길의 고정 패드만 예외로 함께 둔다.
- 0.19.20의 공통 분기 진입·경로 인계 보정을 유지한다. 고도만으로 선택하며, 선택 뒤 고도 변경은 경로를 바꾸지 않는다.

## 경로와 거리

거리는 공통 랩 진행도와 경로의 실제 거리를 구분한다. 공유 진행도는 분기 시작 1055m, 선택 확정 1115m, 합류 끝 1665m다. `physicalDistance()`/`advanceTrackDistance()`로 실제 거리와 변환한다.

| 항목 | 아래 길 | 위 길 |
| --- | --- | --- |
| route id | `terrace-flow-fork:0` | `terrace-flow-fork:1` |
| 이름 | 테라스 슬라럼 | 스카이 익스프레스 |
| `choice` / `roadHeight` | `lower` / `low` | `upper` / `high` |
| `hazards` | `['height']` | `[]` |
| 분기부터 합류까지 실제 거리 | 약 632.19m | 약 658.45m |
| 노면 상승 설계값 | 기본 노면 | 기본 노면에서 최대 +76m |
| 고정 배치 | 몸통 시작 +65m 상승, +205m 하강 | 몸통 시작 +130m 중앙 부스트 패드 |

위 길은 약 26.26m(4.15%) 더 길다. 배치의 몸통 시작은 각 route의 `mouthEnd`, 끝은 `mergeStart`다. 두 장애물 간 실제 거리는 140m다. 고정 장애물은 움직이지 않으며 상승 통과 고도는 5.75–6.2m, 하강은 1.8–2.25m다. 패드 폭은 14m, 길이는 14m다. 트랙 revision은 7에서 8로 올려 변경 전 고스트를 새 노면에 재생하지 않는다.

## 시각 연결 계약

새 snapshot 필드나 export는 필요하지 않다. `RaceSnapshot.forkCue: ForkCue | null`과 `readForkCue(track: Track, pose: ForkCuePose): ForkCue | null`을 그대로 사용한다. `forkRouteCues(fork: TrackFork): readonly ForkRouteCue[]`는 아래→위 순서의 2개 경로를 반환한다.

`forkCue.kind === 'vertical'`, `routes[].choice`는 `lower | upper`, `roadHeight`는 `low | high`다. `defaultRouteId`는 아래 길이며, `previewRouteId`는 입구의 현재 선택 고도를 반영한다. `selectedRouteId`는 확정 뒤에만 채워진다. `phase`는 `approach | choice | route`; `distance`는 각 상태에서 입구·선택 확정·합류까지 남은 실제 미터다.

`BranchVariety = 'arena-three' | 'terrace-height'`이며 이 분기의 `TrackFork.authoredLayout`은 `'terrace-height'`다. `authoredLayout` 유무를 3갈래 판별에 쓰지 말고 경로 개수 또는 정확한 값을 확인한다. `createTrackVisual`·`createForkSign`·`raceApp`·CSS는 로직 브랜치에서 수정하지 않는다.

## 검증

`npm test` 612/612, `npm run build`, `npm run docs:world:check` 통과. 전체 분기 스트레스 검사와 TERRACE FLOW 전용 회귀 검사를 함께 실행했다.

고정 배치·무작위 배치 보존·고도 미리보기/확정·확정 후 고도 변경, 5기체 × 3난이도 × 일반/부스트 × 두 선택의 60조합 입구 통과, 시작 기체/고속 기체의 실제 상승·하강 및 합류 통과를 회귀 검증한다. 전체 분기 테스트는 기존 3갈래 키 홀드와 모든 트랙의 입구·합류 연속성, 실제 거리, NPC 완주를 함께 검증한다. 실제 브라우저의 createRace 입력 경로에서 쉬움·보통·어려움 × ↑/↓ 키의 6조합 모두 올바른 경로로 확정되고, 확정 후 1.5초까지 충돌·이탈 0회, 콘솔 오류 0개였다. 분리 후 실제 100m를 0.25m 간격으로 측정한 최대 곡률은 아래 0.008453m⁻¹, 위 0.008813m⁻¹로 공통 기준 0.012m⁻¹ 이내다. 데스크톱·터치 안내와 표지의 최종 화면 확인은 Claude의 시각 연결 후 수행한다.
