import type { RaceMode } from '../driving/createRaceSession.js';

export interface CampaignRecordStorage {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}
export interface CampaignRelockPreview { mode: RaceMode; trackIds: string[] }

/** Parse cache identities once, including every course/rules version and configuration. */
export function campaignRecordEntries(storage: CampaignRecordStorage): { key: string; mode: RaceMode; trackId: string }[] {
  const entries: { key: string; mode: RaceMode; trackId: string }[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key) continue;
    const ghost = /^speedracer-ghost:([^:]+):/.exec(key);
    if (ghost) { entries.push({ key, mode: 'time-attack', trackId: ghost[1] }); continue; }
    const record = /^speedracer:record:([^:]+):[^:]+:(.+)$/.exec(key);
    if (!record) continue;
    try {
      const config = JSON.parse(decodeURIComponent(record[2]));
      if (!config || typeof config !== 'object' || Array.isArray(config)) continue;
      const mode = config.mode === 'competition' ? 'competition' : 'time-attack';
      const trackId = decodeURIComponent(record[1]).replace(/:v\d+$/, '');
      entries.push({ key, mode, trackId });
    } catch { /* Unrecognized keys do not belong to the campaign record format. */ }
  }
  return entries;
}
/** Leave other modes, feature tests, retired tracks and unrelated storage alone. */
export function campaignRecordKeys(plan: readonly CampaignRelockPreview[], storage: CampaignRecordStorage): string[] {
  const ids = new Map(plan.map(group => [group.mode, new Set(group.trackIds)]));
  return campaignRecordEntries(storage).filter(entry => ids.get(entry.mode)?.has(entry.trackId)).map(entry => entry.key);
}
