# 도시·구역 런타임 계약

통합 브랜치: `feat/marine-campaign-integration`, 기준 main `8582ea0` (0.19.17). 원본 레시피·도시 데이터: `67151b4`. 사용자 결정: 마린시티 4구역 × 4트랙, 33–48번. 네온 32번을 어느 한 모드에서 통과하면 마린시티를 연다. 쉬움도 인정한다. 시각 연결은 Claude, main 머지·버전 변경은 사용자 요청 후 진행한다.

## 계층과 호환성

도시 → 구역 → 트랙. 환경은 구역에서 경기 진입 때 선택하는 별도 상태다.

| 도시 | DistrictId (표시 순서) | 번호 |
|---|---|---|
| 네온시티 `neon` | residential / industrial / stadium / skyline / research / orbital / harbor / desert | 1–32 |
| 마린시티 `marine` | abyss / kelp / coral / lagoon | 33–48 |

`abyss`는 호환성을 위해 유지하고 표시 이름만 **심해 해구**로 바꾼다. zone ID는 `trench`다. 기존 네온 32트랙의 ID·order·predecessor·revision·기하는 유지한다. `trench-line`은 별도 기능 테스트 트랙으로 유지하며 도시 집계·보상·해금에 포함하지 않는다. 새 정식 첫 트랙은 `trench-entry`다.

## 화면용 순수 데이터 API

`src/game/track/cityCatalog.ts`:

```ts
export type CityId = 'neon' | 'marine';
export interface CityDefinition {
  readonly id: CityId;
  readonly name: string;
  readonly order: number;
  readonly districts: readonly DistrictId[];
}
export const CITY_CATALOG: readonly CityDefinition[];
export const DISTRICT_CITY: Readonly<Record<DistrictId, CityId>>;
export const MARINE_GATE_TRACK_ID: string;
export function cityForDistrict(district: DistrictId): CityId;
export function cityDefinition(city: CityId): CityDefinition;
export function campaignTracksForCity(city: CityId): readonly TrackDefinition[];
```

`CITY_CATALOG`는 도시 표시 순서, `city.districts`는 도시 내부 구역 순서다. 트랙 번호는 전역 1–48을 유지한다. 표시 이름·색·설명은 `DISTRICTS[district]`에서 읽는다. 배열은 동결돼 있으며 `campaignTracksForCity()`는 카탈로그 순서의 정식 트랙만 반환한다. `TrackDefinition.city`를 중복 저장하지 않는다.

`src/game/progression/campaign.ts`:

```ts
export type CampaignCityStatus = 'locked' | 'available' | 'cleared';
export function campaignCityStatus(
  progress: CampaignProgress, mode: RaceMode, city: CityId,
): CampaignCityStatus;
// 기존 트랙 단위 시작 가능 여부 API 유지
export function campaignStatus(
  progress: CampaignProgress, mode: RaceMode, track: TrackDefinition,
): 'locked' | 'available' | 'cleared';
```

도시 `cleared`는 선택 모드에서 그 도시의 정식 트랙을 모두 통과했을 때다. 네온은 처음부터 `available`, 마린은 도시 gate가 열리면 `available`이다. 시작 버튼·직접 URL은 기존 `campaignStatus()`로 검사한다. 저장된 선택(`campaign-select`)은 잠긴 트랙의 미리보기도 허용하는 기존 동작을 유지한다. 잠긴 결과 제출은 보상 트랜잭션에서 거절한다.

## 해금·저장·보상

- 모두 해금 테스트 플래그가 켜지면 도시·트랙 gate를 우회한다. 끄기는 정상 선행 체인과 도시 gate를 순서대로 다시 판정해 진행·기록을 정리하며, 지갑은 유지한다([토글 계약](CAMPAIGN_UNLOCK_TEST.md)).
- 도시 gate: `MARINE_GATE_TRACK_ID`(네온시티 마지막, 32 SOLSTICE CIRCUIT)의 `cleared`를 두 모드에서 OR로 확인한다. 모드별 총 통과 수나 전체 카탈로그 마지막 트랙으로 계산하지 않는다.
- 쉬움·중간·어려움 통과와 난이도 저장 도입 전의 `cleared`도 인정한다. 별 개수·보조 사용 여부로 추가 제한하지 않는다.
- 마린 첫 트랙(33)은 `predecessor=null`. 이후 34–48은 직전 마린 트랙을 선택 모드에서 통과해야 열린다. 타임어택으로 도시를 열어도 경쟁 33번부터 시작할 수 있고, 경쟁 34번은 경쟁 33번 통과가 필요하다.
- 이미 통과한 트랙의 재도전은 유지한다. 기존 소유 기체·강화·포인트·기록과 retired ID를 지우지 않는다. 저장 스키마·트랙 revision bump는 필요 없다.
- 기본 완주·클린·순위 보상은 기존 정책을 사용한다. 첫 통과 보너스는 **모드/트랙당** `100 + rating × 25 P`로 1회: 구역마다 125/150/175/200 P. 도시 전체 보너스는 추가하지 않는다. 마린 16트랙의 첫 통과 보너스 합은 모드당 2,600 P다. 실격은 0, 통과 순위 밖 경쟁 완주는 기존 기본·순위 보상만 지급한다. 같은 경기 저장을 재시도해도 중복 지급하지 않는다.

## 정식 트랙 레시피

모두 3랩이다. 각 구역 rating 1→2→3→4, 고도 2→2→3→4단, 도로 반폭 14/14/14/13m. 구역 입구에서는 쉬운 곡선과 노면 회전부터 시작하고 이후 코일·루프·입체 교차를 늘린다. 제한시간은 중간 난이도 기준이며 쉬움/어려움은 기존 배율을 적용한다.

| 번호 | 구역 | 이름 / ID | 형태 | 중간 랩 제한 |
|---|---|---|---|---:|
|33|abyss|TRENCH ENTRY / trench-entry|ring|100초|
|34|abyss|ABYSS FLOW / abyss-flow|kidney|112초|
|35|abyss|PRESSURE LOOP / pressure-loop|triangle|115초|
|36|abyss|RIFT DESCENT / rift-descent|eight|132초|
|37|kelp|KELP PASSAGE / kelp-passage|kidney|102초|
|38|kelp|CANOPY SWEEP / canopy-sweep|ring|113초|
|39|kelp|ROOT SPIRAL / root-spiral|thumb|121초|
|40|kelp|FOREST WEAVE / forest-weave|clover|132초|
|41|coral|CORAL APPROACH / coral-approach|triangle|101초|
|42|coral|REEF CIRCUIT / reef-circuit|kidney|111초|
|43|coral|GARDEN HELIX / garden-helix|clover|123초|
|44|coral|CROWN CURRENT / crown-current|eight|134초|
|45|lagoon|LAGOON GLIDE / lagoon-glide|ring|102초|
|46|lagoon|SUNLIT ARC / sunlit-arc|triangle|113초|
|47|lagoon|TIDAL CROSSING / tidal-crossing|eight|128초|
|48|lagoon|SURFACE RUSH / surface-rush|star|138초|

제작 데이터는 `marineTrackCatalog.ts`의 `MARINE_TRACK_CATALOG`이며 `TRACK_CATALOG` 뒤에 붙는다. 이번 16트랙에는 별도 분기·점프를 추가하지 않는다. 분기 다양화는 로드맵의 별도 묶음이다. 완주·노면 연속성·도로 간격 검증은 기존 캠페인 검사에 포함한다.

## 구역별 환경 계약

Claude가 `marineZones.ts`의 `MarineZone`, `MARINE_ZONES`, `marineZone()`, `marinePaletteFor()`와 시각 프리셋을 소유한다. Codex는 `raceEnvironment.ts`에서 그 환경 배열을 직접 사용한다.

| DistrictId | zone ID | 환경 ID |
|---|---|---|
| 지상 8구역 | — | NIGHT_ENVIRONMENTS 5종 |
| abyss | trench | abyss-shallow / abyss-deep |
| kelp | kelp | kelp-forest |
| coral | coral | coral-garden |
| lagoon | lagoon | sun-lagoon |

```ts
export function raceEnvironmentsForDistrict(district?: string): readonly RaceEnvironment[];
export function selectRaceEnvironment(district?: string, random?: () => number): RaceEnvironment;
```

`raceEnvironmentsForDistrict()`는 해당 zone.environments 배열 자체를 반환한다. 환경을 추가하면 선택 함수는 수정 없이 반영한다. `ABYSS_ENVIRONMENTS`는 해구 2종, `UNDERWATER_ENVIRONMENTS`는 모든 zone 환경을 모은 배열이다. 미지정 자유 주행은 한밤중, 알 수 없는 구역은 기존 밤하늘 pool로 처리한다.

모든 물속 환경은 underwater=true / celestial=none / stars=0 / rain=false다. 경기 시작 때 한 번 선택하고 재도전에는 유지한다. `&zone=<MarineZoneId>`는 기존 기능 테스트 미리보기 전용이며 정식 캠페인 환경을 덮어쓰지 않는다. 시각 분기는 `environment.underwater`로 유지한다. `landmarkCatalog.ts`에 새 구역의 돔·연결교와 팔레트색을 추가했다. 전용 해저 장식·도시 헤더는 기존 Claude 구현을 사용한다. `campaignApp.ts`의 임시 도시 상수는 `CITY_CATALOG`와 `cityForDistrict()`로 교체했다. 도시 잠금 안내는 `campaignCityStatus()`를 사용한다.

## 검증과 연결 순서

도시 gate(모드 2종 × 난이도 3종), 구역 순서·레시피·환경 pool, 기존 저장 복원, 모드별 마린 진행, 첫 통과/재도전 보상을 테스트한다. 기존 캠페인 테스트는 새 16트랙을 포함해 기본 기체 5종 완주, 도로 간격·자세 연속성, 모바일·데스크톱 전체 캠페인 여정을 검사한다.

기존 도시 헤더·잠금 안내와 구역별 해저 시각에 정식 데이터를 연결했다. Claude는 이 커밋을 기준으로 화면을 확인한다. 연결 후 화면을 검증하고 사용자 요청 시 main에 머지하며 버전·로드맵 체크를 그때 한 번 갱신한다.

통합 검증: `npm test` 583/583, `npm run build`, `npm run docs:world:check` 통과. 모두 해금·공유 도시 gate를 포함한 집중 테스트 17/17도 통과했다. 화면 시각 확인은 Claude가 이어서 진행한다.
