import { TRACK_CATALOG, campaignLapLimit } from '../track/trackCatalog.js';
import type { TrackDefinition } from '../track/trackCatalog.js';
import type { RaceMode } from '../driving/createRaceSession.js';

export interface CampaignTrackProgress {
  cleared: boolean; attempts: number; clearedAt?: number;
  records: Record<string, { total: number; laps: number[]; rank: number; assisted: boolean }>;
}
export interface CampaignProgress {
  modes: Record<RaceMode, Record<string, CampaignTrackProgress>>;
  last: { mode: RaceMode; trackId: string };
  knownTracks: string[];
}
export const initialCampaign = (): CampaignProgress => ({ knownTracks: TRACK_CATALOG.map(t => t.id), modes: { 'time-attack': {}, competition: {} }, last: { mode: 'time-attack', trackId: TRACK_CATALOG[0].id } });
export function campaignStatus(progress: CampaignProgress, mode: RaceMode, track: TrackDefinition) {
  if (progress.modes[mode][track.id]?.cleared) return 'cleared';
  return !track.predecessor || progress.modes[mode][track.predecessor]?.cleared ? 'available' : 'locked';
}
export function nextCampaignTrack(progress: CampaignProgress, mode: RaceMode, catalog = TRACK_CATALOG) {
  return catalog.find(t => campaignStatus(progress, mode, t) === 'available') ?? catalog[0];
}
export function validateCampaign(value: unknown): CampaignProgress {
  if (!value || typeof value !== 'object') throw new Error('잘못된 캠페인 저장 데이터');
  const c = structuredClone(value) as CampaignProgress;
  c.knownTracks ??= TRACK_CATALOG.map(t => t.id);
  if (!Array.isArray(c.knownTracks) || c.knownTracks.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id))) throw new Error('잘못된 트랙 목록');
  if (!c.modes || !c.last || !['time-attack', 'competition'].includes(c.last.mode) || typeof c.last.trackId !== 'string') throw new Error('잘못된 캠페인 저장 데이터');
  for (const mode of ['time-attack', 'competition'] as const) {
    const data = c.modes[mode];
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('잘못된 캠페인 진행 기록');
    // Keep unknown/retired track IDs: later releases may restore them.
    for (const [id, entry] of Object.entries(data)) {
      if (!/^[a-z][a-z0-9-]*$/.test(id) || !entry || typeof entry.cleared !== 'boolean' || !Number.isSafeInteger(entry.attempts) || entry.attempts < 0 || !entry.records || typeof entry.records !== 'object' || Array.isArray(entry.records)) throw new Error('잘못된 캠페인 트랙 기록');
      if (entry.clearedAt !== undefined && (!Number.isFinite(entry.clearedAt) || entry.clearedAt < 0)) throw new Error('잘못된 클리어 시간');
      for (const r of Object.values(entry.records)) if (!r || !Number.isFinite(r.total) || r.total <= 0 || !Array.isArray(r.laps) || !r.laps.length || r.laps.some(n => !Number.isFinite(n) || n <= 0) || !Number.isInteger(r.rank) || r.rank < 1 || r.rank > 4 || typeof r.assisted !== 'boolean') throw new Error('잘못된 캠페인 랩 기록');
    }
  }
  return structuredClone(c);
}
export interface CampaignOutcome {
  mode: RaceMode; trackId: string; revision: number; total: number; laps: number[];
  rank: number; disqualified: boolean; assisted: boolean; lapLimit: number;
}
/** Unlocks and records are written by the same transaction as the race reward. */
export function completeCampaign(progress: CampaignProgress, outcome: CampaignOutcome) {
  const track = TRACK_CATALOG.find(t => t.id === outcome.trackId);
  if (!track || track.revision !== outcome.revision || !['time-attack', 'competition'].includes(outcome.mode)
    || !Number.isFinite(outcome.total) || outcome.total <= 0 || !Number.isFinite(outcome.lapLimit) || outcome.lapLimit <= 0
    || !Number.isInteger(outcome.rank) || outcome.rank < 1 || outcome.rank > 4 || typeof outcome.disqualified !== 'boolean' || typeof outcome.assisted !== 'boolean'
    || !Array.isArray(outcome.laps) || outcome.laps.some(n => !Number.isFinite(n) || n <= 0)) throw new Error('잘못된 캠페인 결과');
  const allowedLimit = campaignLapLimit(track);
  if (outcome.mode === 'time-attack' && outcome.lapLimit !== allowedLimit) throw new Error('잘못된 랩 제한시간');
  if (outcome.laps.length > track.laps || (!outcome.disqualified && (outcome.laps.length !== track.laps || Math.abs(outcome.laps.reduce((a, b) => a + b, 0) - outcome.total) > .003))) throw new Error('잘못된 랩 합계');
  if (campaignStatus(progress, outcome.mode, track) === 'locked') throw new Error('아직 도전할 수 없는 트랙입니다.');
  const entry = progress.modes[outcome.mode][track.id] ??= { cleared: false, attempts: 0, records: {} };
  entry.attempts++;
  const passed = !outcome.disqualified && outcome.laps.length === track.laps && (outcome.mode === 'competition' ? outcome.rank === 1 : outcome.laps.every(lap => lap <= allowedLimit));
  const firstClear = passed && !entry.cleared;
  if (passed) { entry.cleared = true; entry.clearedAt ??= Date.now(); }
  if (!outcome.disqualified && outcome.laps.length === track.laps) {
    const key = `${track.revision}:${outcome.assisted ? 'assisted' : 'normal'}`;
    if (!entry.records[key] || entry.records[key].total > outcome.total) entry.records[key] = { total: outcome.total, laps: [...outcome.laps], rank: outcome.rank, assisted: outcome.assisted };
  }
  return { passed, firstClear, bonus: firstClear ? 100 + track.rating * 25 : 0 };
}
