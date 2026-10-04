export const RACE_RULES_VERSION = 'time-attack-v1';
export const RACE_LAPS = 3;

export interface TravelSegment {
  from: number;
  to: number;
  offsetFrom: number;
  offsetTo: number;
  timeFrom: number;
  timeTo: number;
}

/** Ordered swept gates in unwrapped track coordinates. Teleports never enter this API. */
export function createRaceProgress(length: number, gatesPerLap: number, halfWidth: number) {
  if (!(length > 0) || !Number.isFinite(length) || !Number.isInteger(gatesPerLap) || gatesPerLap < 1 || !(halfWidth > 0)) throw new Error('Invalid race course');
  const spacing = length / gatesPerLap;
  let passed = 0;
  let finishTime: number | null = null;
  let lapStart = 0;
  const lapTimes: number[] = [];
  const snapshot = () => ({
    lap: Math.min(RACE_LAPS, Math.floor(passed / gatesPerLap) + 1),
    completedLaps: lapTimes.length,
    gatesPassed: passed % gatesPerLap,
    gatesPerLap,
    checkpoint: passed * spacing,
    nextCheckpoint: (passed + 1) * spacing,
    lapTimes: [...lapTimes], finishTime,
  });
  return {
    snapshot,
    get checkpoint() { return passed * spacing; },
    reset() { passed = 0; finishTime = null; lapStart = 0; lapTimes.length = 0; },
    cross(segment: TravelSegment) {
      if (finishTime !== null || !Object.values(segment).every(Number.isFinite) || segment.to <= segment.from || segment.timeTo <= segment.timeFrom) return null;
      while (passed < gatesPerLap * RACE_LAPS) {
        const gate = (passed + 1) * spacing;
        // A missed gate requires recovery; later gates cannot repair its sequence.
        if (segment.from >= gate || segment.to < gate) break;
        const fraction = (gate - segment.from) / (segment.to - segment.from);
        const offset = segment.offsetFrom + (segment.offsetTo - segment.offsetFrom) * fraction;
        if (Math.abs(offset) > halfWidth + 1e-8) break;
        passed++;
        if (passed % gatesPerLap === 0) {
          const time = Math.round((segment.timeFrom + (segment.timeTo - segment.timeFrom) * fraction) * 1000) / 1000;
          lapTimes.push(time - lapStart); lapStart = time;
          if (lapTimes.length === RACE_LAPS) { finishTime = time; return time; }
        }
      }
      return null;
    },
  };
}
