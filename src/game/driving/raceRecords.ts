import { RACE_LAPS, RACE_RULES_VERSION } from './raceProgress.js';

export interface RaceRecord { total: number; laps: number[]; recordedAt: string; checkpointTimes?: number[] }
export interface RecordStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface RecordScope { trackId: string; configurationId: string; laps?: number }
export interface RecordResult { best: RaceRecord; isNewBest: boolean; improvedExistingBest: boolean; saved: boolean }

const validRecord = (record: unknown, lapCount = RACE_LAPS): record is RaceRecord => {
  if (!record || typeof record !== 'object') return false;
  const r = record as RaceRecord;
  return Number.isFinite(r.total) && r.total > 0 && r.total < 86400 && Array.isArray(r.laps) && r.laps.length === lapCount
    && r.laps.every(lap => Number.isFinite(lap) && lap > 0)
    && Math.abs(r.laps.reduce((sum, lap) => sum + lap, 0) - r.total) < 1e-6
    && (r.checkpointTimes === undefined || validCheckpointTimes(r.checkpointTimes, r.laps, r.total))
    && typeof r.recordedAt === 'string' && Number.isFinite(Date.parse(r.recordedAt));
};
const validCheckpointTimes = (times: number[], laps: number[], total: number) => Array.isArray(times)
  && times.length > 0 && times.length <= 10000 && times.length % laps.length === 0
  && times.every((time, index) => Number.isFinite(time) && time >= 0 && time <= total
    && (index === 0 || time >= times[index - 1]))
  && laps.every((_, index) => Math.abs(times[(index + 1) * (times.length / laps.length) - 1]
    - laps.slice(0, index + 1).reduce((sum, lap) => sum + lap, 0)) < 1e-6);
const copy = (record: RaceRecord | null) => record ? { ...record, laps: [...record.laps], ...(record.checkpointTimes ? { checkpointTimes: [...record.checkpointTimes] } : {}) } : null;

/** Storage is optional: denied access or malformed data cannot stop a race. */
export function createRaceRecords(scope: RecordScope, storage?: RecordStorage) {
  const key = `speedracer:record:${encodeURIComponent(scope.trackId)}:${RACE_RULES_VERSION}:${encodeURIComponent(scope.configurationId)}`;
  let best: RaceRecord | null = null;
  let persisted = false;
  const refresh = () => {
    try {
      const payload = JSON.parse(storage?.getItem(key) ?? 'null');
      if (payload?.trackId === scope.trackId && payload?.configurationId === scope.configurationId && payload?.rulesVersion === RACE_RULES_VERSION && validRecord(payload.record, scope.laps)
        && (!best || payload.record.total <= best.total)) {
        best = copy(payload.record); persisted = true;
      }
    } catch { /* A broken or blocked store cannot discard the in-memory best. */ }
  };
  refresh();
  return {
    key,
    read: () => copy(best),
    save(total: number, laps: readonly number[], checkpointTimes?: readonly number[]): RecordResult {
      const record = { total, laps: [...laps], recordedAt: new Date().toISOString(),
        ...(checkpointTimes ? { checkpointTimes: [...checkpointTimes] } : {}) };
      if (!validRecord(record, scope.laps)) throw new Error('Invalid completed race');
      refresh(); // Another tab may have finished a faster race since this one started.
      const hadBest = best !== null;
      const isNewBest = !best || total < best.total - 1e-8;
      if (isNewBest) { best = record; persisted = false; }
      if (!persisted && storage) {
        try {
          storage.setItem(key, JSON.stringify({ ...scope, rulesVersion: RACE_RULES_VERSION, record: best }));
          persisted = true;
        } catch { /* Keep the best in memory for another attempt. */ }
      }
      return { best: copy(best)!, isNewBest, improvedExistingBest: hadBest && isNewBest, saved: persisted };
    },
  };
}
