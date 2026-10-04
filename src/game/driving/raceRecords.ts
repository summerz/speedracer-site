import { RACE_LAPS, RACE_RULES_VERSION } from './raceProgress.js';

export interface RaceRecord { total: number; laps: number[]; recordedAt: string }
export interface RecordStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface RecordScope { trackId: string; configurationId: string }
export interface RecordResult { best: RaceRecord; isNewBest: boolean; saved: boolean }

const validRecord = (record: unknown): record is RaceRecord => {
  if (!record || typeof record !== 'object') return false;
  const r = record as RaceRecord;
  return Number.isFinite(r.total) && r.total > 0 && r.total < 86400 && Array.isArray(r.laps) && r.laps.length === RACE_LAPS
    && r.laps.every(lap => Number.isFinite(lap) && lap > 0)
    && Math.abs(r.laps.reduce((sum, lap) => sum + lap, 0) - r.total) < 1e-6
    && typeof r.recordedAt === 'string' && Number.isFinite(Date.parse(r.recordedAt));
};
const copy = (record: RaceRecord | null) => record ? { ...record, laps: [...record.laps] } : null;

/** Storage is optional: denied access or malformed data cannot stop a race. */
export function createRaceRecords(scope: RecordScope, storage?: RecordStorage) {
  const key = `speedracer:record:${encodeURIComponent(scope.trackId)}:${RACE_RULES_VERSION}:${encodeURIComponent(scope.configurationId)}`;
  let best: RaceRecord | null = null;
  let persisted = false;
  const refresh = () => {
    try {
      const payload = JSON.parse(storage?.getItem(key) ?? 'null');
      if (payload?.trackId === scope.trackId && payload?.configurationId === scope.configurationId && payload?.rulesVersion === RACE_RULES_VERSION && validRecord(payload.record)
        && (!best || payload.record.total <= best.total)) {
        best = copy(payload.record); persisted = true;
      }
    } catch { /* A broken or blocked store cannot discard the in-memory best. */ }
  };
  refresh();
  return {
    key,
    read: () => copy(best),
    save(total: number, laps: readonly number[]): RecordResult {
      const record = { total, laps: [...laps], recordedAt: new Date().toISOString() };
      if (!validRecord(record)) throw new Error('Invalid completed race');
      refresh(); // Another tab may have finished a faster race since this one started.
      const isNewBest = !best || total < best.total - 1e-8;
      if (isNewBest) { best = record; persisted = false; }
      if (!persisted && storage) {
        try {
          storage.setItem(key, JSON.stringify({ ...scope, rulesVersion: RACE_RULES_VERSION, record: best }));
          persisted = true;
        } catch { /* Keep the best in memory for another attempt. */ }
      }
      return { best: copy(best)!, isNewBest, saved: persisted };
    },
  };
}
