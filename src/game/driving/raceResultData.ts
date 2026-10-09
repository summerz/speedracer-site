/** Seconds throughout; negative deltas mean faster than the pre-race personal best. */
export interface CheckpointSplit {
  checkpoint: number;
  lap: number;
  gate: number;
  distance: number;
  elapsed: number;
  segmentTime: number;
  bestElapsed: number | null;
  bestSegmentTime: number | null;
  delta: number | null;
  segmentDelta: number | null;
}

export function checkpointSplits(times: readonly number[], best: readonly number[] | undefined,
  gatesPerLap: number, trackLength: number): CheckpointSplit[] {
  return times.map((elapsed, index) => {
    const segmentTime = elapsed - (times[index - 1] ?? 0);
    const bestElapsed = best?.[index] ?? null;
    const bestSegmentTime = bestElapsed === null ? null : bestElapsed - (best?.[index - 1] ?? 0);
    return { checkpoint: index + 1, lap: Math.floor(index / gatesPerLap) + 1, gate: index % gatesPerLap + 1,
      distance: (index + 1) * trackLength / gatesPerLap, elapsed, segmentTime, bestElapsed, bestSegmentTime,
      delta: bestElapsed === null ? null : elapsed - bestElapsed,
      segmentDelta: bestSegmentTime === null ? null : segmentTime - bestSegmentTime };
  });
}

export interface RaceStats {
  collisions: number;
  nearMisses: number;
  bestStreak: number;
  offTrackExits: number;
  boostUses: number;
}

export interface SectorDelta {
  checkpoint: number;
  lap: number;
  gate: number;
  time: number;
  bestTime: number;
  /** This sector's time minus the same sector in the pre-race PB. */
  delta: number;
  cumulativeDelta: number;
}

/** Structurally accepts race.timeAttack (the session snapshot), without renderer dependencies. */
export interface RaceResultSource {
  lapTimes: readonly number[];
  comparisonRecord: { total: number; laps: readonly number[] } | null;
  checkpointSplits: readonly CheckpointSplit[];
  raceStats: RaceStats;
}

export interface RaceResultData extends RaceStats {
  previousBestTotal: number | null;
  lapDeltas: (number | null)[];
  /** Omitted when the previous PB has no compatible checkpoint timings. */
  sectors?: SectorDelta[];
}

export function raceResultData(source: RaceResultSource): RaceResultData {
  const sectors = source.checkpointSplits.flatMap(split => split.bestSegmentTime === null || split.segmentDelta === null || split.delta === null
    ? [] : [{ checkpoint: split.checkpoint, lap: split.lap, gate: split.gate, time: split.segmentTime,
      bestTime: split.bestSegmentTime, delta: split.segmentDelta, cumulativeDelta: split.delta }]);
  return { ...source.raceStats, previousBestTotal: source.comparisonRecord?.total ?? null,
    lapDeltas: source.lapTimes.map((time, index) => {
      const best = source.comparisonRecord?.laps[index];
      return best === undefined ? null : time - best;
    }), ...(sectors.length ? { sectors } : {}) };
}
