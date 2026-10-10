# 수중 도시 런타임 계약

2026-10-10. 기획은 Claude의 `design/abyss-plan` (`22b5118`, `docs/ABYSS_DISTRICT.md`)을 따른다. 이 계약은 데이터·선택·시험 진입을 담당하며 물속 하늘과 해저 장식은 Claude가 연결한다. 캠페인 추가는 사용자 확인 뒤 별도로 진행한다.

## 시험 트랙과 진입

`DistrictId`에 `abyss`를 추가하고 `DISTRICTS.abyss`에 구역 이름·발광색·설명을 제공한다. `FEATURE_TEST_TRACKS`의 유일한 레시피는 `trench-line` / TRENCH LINE이다. 1랩, 고도 2단계, 반폭 14m, 완만한 콩 모양 경로와 노면 회전 1개를 사용한다. `order: 0`은 시험용 표시이며 정식 번호가 아니다. 분기·점프·주행 물리는 기존 규칙을 유지한다.

격납고의 기능 테스트에서 다음 주소로 진입한다.

`#drive?track=trench-line&mode=time-attack&challenge=easy&test=1`

`test=1`이 없으면 시험 트랙은 진입할 수 없다. 기존 VOLTAGE YARD 점프 테스트도 유지한다. 시험 트랙 종료 시 격납고로 돌아간다. `raceApp`의 기존 시험 세션 경로를 사용하므로 타임어택 연습으로 실행하고 제한시간 실격·아이템 소비·기록 저장·보상·해금을 적용하지 않는다. `TRACK_CATALOG`와 `trackDefinition()`은 기존 캠페인 32개만 반환하며 캠페인 목록에도 수중 구역을 표시하지 않는다.

`src/game/track/featureTestTracks.ts`:

```ts
export interface FeatureTestTrackDefinition extends TrackDefinition {
  readonly instructions: string;
}
export const FEATURE_TEST_TRACKS: readonly FeatureTestTrackDefinition[];
export function resolveDriveTrack(id: string, featureTest: boolean): TrackDefinition | undefined;
export function isFeatureTestTrack(id: string): boolean;
export function featureTestTrackHref(id: string): string;
```

## 환경 선택

`src/game/environment/raceEnvironment.ts`:

```ts
export type UnderwaterEnvironmentId = 'abyss-shallow' | 'abyss-deep';
export type RaceEnvironmentId = NightEnvironmentId | UnderwaterEnvironmentId;
export interface RaceEnvironment {
  id: RaceEnvironmentId;
  underwater: boolean;
  // 기존 색상·안개·조명·천체·날씨 필드는 유지한다.
  celestial: 'moon' | 'ringed-planet' | 'crescent' | 'satellite' | 'none';
}
export interface UnderwaterEnvironment extends RaceEnvironment {
  id: UnderwaterEnvironmentId;
  underwater: true;
  celestial: 'none';
  stars: 0;
  rain: false;
}
export const ABYSS_ENVIRONMENTS: readonly UnderwaterEnvironment[];
export const UNDERWATER_ENVIRONMENTS: readonly UnderwaterEnvironment[]; // 같은 배열의 호환 별칭
export function raceEnvironmentsForDistrict(district?: string): readonly RaceEnvironment[];
export function selectRaceEnvironment(district?: string, random?: () => number): RaceEnvironment;
export function previewRaceEnvironment(environment: RaceEnvironment, rain?: boolean): RaceEnvironment;
```

`ABYSS_ENVIRONMENTS`는 `abyssEnvironment.ts`에 정의하며 `raceEnvironment.ts`에서도 다시 export한다. Claude의 `afed6a0` 색상·조명 프리셋을 유지하고 타입은 `UnderwaterEnvironment`, 천체는 `none`, 비는 `false`로 맞춘다.

기존 `NightEnvironment` 타입과 `NIGHT_ENVIRONMENTS`는 유지하며 `underwater: false`로 좁힌다. `abyss`는 수중 환경 2종만 균등 선택한다. 기존 캠페인 구역은 밤하늘 5종, 구역 없는 자유 주행은 한밤중을 유지한다. 경기 화면 진입 시 한 번 선택하고 재도전에서는 같은 객체를 재사용한다.

수중 환경은 별·천체·비를 끈다. 개발용 비 토글은 숨기고 `previewRaceEnvironment()`도 수중 객체를 그대로 반환하므로 비·번개·천둥으로 덮어쓰지 않는다. 해양 부유물은 별도 시각 효과이며 날씨의 `rain`을 켜서 구현하지 않는다.

## Claude 연결 지점

- `createRace()` 환경 인자는 `RaceEnvironment`를 받는다. `environment.underwater`로 하늘·물속 효과를 선택할 수 있다.
- `createNightSky()` 입력 타입만 확장했다. 수중 전용 하늘 렌더링은 Claude가 구현한다.
- Claude의 `afed6a0`은 `createRace()`의 개발 미리보기에서 `createAbyssScenery()`·해양 부유물·격자 숨김을 묶는다. 정식 연결은 `course?.district === 'abyss'`로 선택하며 `createAbyssScenery()`는 기존 장식과 같은 반환 형태에 `hidesGround: true`를 제공한다. `selectedEnvironment` 인자 이름과 시각 연결은 Claude가 반영한다.
- `LANDMARK_DISTRICTS.abyss`는 기존 돔·연결교 종류를 이용한 임시 데이터다. 전용 시각 형상은 Claude가 조정한다.
- 격납고 링크·시험별 준비 안내 문구·격납고 복귀 버튼·개발 비 토글 숨김만 최소 변경했다. 안내 화면·씬 연출·음악은 이 작업에서 추가하지 않았다.

## 생성 문서

`npm run docs:world`는 캠페인과 시험 레시피를 함께 문서화하되 캠페인 수·통과 순위와 시험용 표시를 구분한다. `WORLD_ENVIRONMENTS.md`의 구역별 선택 범위는 실제 선택 함수와 같은 데이터를 사용한다. `npm run docs:world:check`로 일치를 확인한다.
