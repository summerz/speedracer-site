# 결과 화면 데이터 연결

`src/game/driving/raceResultData.ts`는 렌더러·DOM·저장소에 의존하지 않는 순수 모듈이다.

```ts
import { raceResultData } from './game/driving/raceResultData.js';

const data = raceResultData(race.snapshot().timeAttack);
```

## 화면용 export

```ts
export function raceResultData(source: RaceResultSource): RaceResultData;

export interface RaceResultSource {
  lapTimes: readonly number[];
  comparisonRecord: { total: number; laps: readonly number[] } | null;
  checkpointSplits: readonly CheckpointSplit[];
  raceStats: RaceStats;
}

export interface RaceStats {
  collisions: number;
  nearMisses: number;
  bestStreak: number;
  offTrackExits: number;
  boostUses: number;
}

export interface RaceResultData extends RaceStats {
  previousBestTotal: number | null;
  lapDeltas: (number | null)[];
  sectors?: SectorDelta[];
}

export interface SectorDelta {
  checkpoint: number;
  lap: number;
  gate: number;
  time: number;
  bestTime: number;
  delta: number;
  cumulativeDelta: number;
}
```

- 시간 값은 초다. 차이는 `이번 기록 - 이전 최고 기록`이므로 음수는 개선, 양수는 지연이다.
- **`previousBestTotal`, `lapDeltas`, `sectors`는 모두 이번 주행 시작 시 보관한 동일한 이전 PB를 기준으로 한다.** 이번 주행이 새 PB로 저장되어도 비교 기준은 바뀌지 않는다.
- `lapDeltas`는 완주한 랩 순서다. 해당 이전 랩 기록이 없으면 `null`이다.
- `sectors[].delta`는 해당 체크포인트 구간만의 차이, `cumulativeDelta`는 출발부터 해당 체크포인트까지 누적 차이다. `checkpoint`는 주행 전체의 1부터 시작하는 번호, `lap`과 `gate`도 1부터 시작한다.
- 이전 PB가 없거나 과거 저장 기록에 호환되는 체크포인트 시간이 없으면 `sectors` 속성을 생략한다. 이 경우 구간 카드를 숨겨도 된다. 이전 기록을 이기면 새 PB에 구간 시간이 함께 저장된다.
- 충돌·니어미스·코스 이탈은 주행 모델의 실제 판정 횟수다. `bestStreak`는 이번 주행 중 가장 긴 클린 연속이다. `boostUses`는 실제로 부스트가 시작된 횟수이며 누르고 있는 프레임 수나 2단계 진입 횟수가 아니다. 브레이크·각성·부스트 잠금 중에는 증가하지 않는다.
- 일시정지는 시간을 진행시키지 않고 집계를 보존한다. 재시작은 모든 집계를 초기화하고 이전 PB를 다시 읽는다. 제한 시간 초과 결과에는 통과한 구간과 완료한 랩만 들어간다.

## 원시 체크포인트 export

```ts
export function checkpointSplits(
  times: readonly number[], best: readonly number[] | undefined,
  gatesPerLap: number, trackLength: number,
): CheckpointSplit[];

export interface CheckpointSplit {
  checkpoint: number; lap: number; gate: number; distance: number;
  elapsed: number; segmentTime: number;
  bestElapsed: number | null; bestSegmentTime: number | null;
  delta: number | null; segmentDelta: number | null;
}
```

`race.snapshot().timeAttack.checkpointSplits`가 이 값을 제공한다. 체크포인트 시간은 물리 구간 안에서 통과 시점을 보간한다. `distance`는 랩을 포함한 누적 거리다.

## 먼저 도착한 NPC

NPC의 공식 거리·완주 시간·순위는 결승 판정 순간 동결한다. `rival.finishCoast?.pose`는 표시용 상태로만 결승선 너머에서 감속해 대기한다. 기존 기체 표시에는 `finishCoast?.pose ?? controller.model.state`를 적용했다. 완주 NPC는 충돌 대상으로 돌아오지 않으며, 일시정지 후 재개해도 다시 출발하지 않는다. 새 경주에서는 표시용 상태도 초기화한다.

검증: `tests/raceResultData.test.mjs`, `tests/competition.test.mjs`.
