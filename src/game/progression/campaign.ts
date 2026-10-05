import { TRACK_CATALOG, campaignRankLimit } from '../track/trackCatalog.js';
import type { TrackDefinition } from '../track/trackCatalog.js';
import { RACE_PARTICIPANT_COUNT } from '../driving/aiRoster.js';
import { challengeLapLimit, challengeStars, raceChallenge, type RaceChallengeId } from '../track/raceChallenge.js';
import type { RaceMode } from '../driving/createRaceSession.js';

export interface CampaignRecord { total: number; laps: number[]; rank: number; assisted: boolean }
export interface CampaignClearRecord extends CampaignRecord { revision: number }

export interface CampaignDifficultyProgress {
  stars?: number;
  cleared: boolean; attempts: number; clearedAt?: number;
  records: Record<string, CampaignRecord>;
  clearRecord?: CampaignClearRecord;
}
export interface CampaignTrackProgress extends CampaignDifficultyProgress {
  difficulties?: Partial<Record<RaceChallengeId, CampaignDifficultyProgress>>;
}
export interface CampaignProgress {
  modes: Record<RaceMode, Record<string, CampaignTrackProgress>>;
  last: { mode: RaceMode; trackId: string; challenge?: RaceChallengeId };
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
function validateEntry(entry: CampaignDifficultyProgress) {
  if (!entry || typeof entry.cleared !== 'boolean' || !Number.isSafeInteger(entry.attempts) || entry.attempts < 0 || !entry.records || typeof entry.records !== 'object' || Array.isArray(entry.records)) throw new Error('잘못된 캠페인 트랙 기록');
  if (entry.clearRecord !== undefined && (!entry.cleared || !Number.isSafeInteger(entry.clearRecord?.revision) || entry.clearRecord.revision < 1)) throw new Error('잘못된 통과 기록');
  if (entry.clearedAt !== undefined && (!Number.isFinite(entry.clearedAt) || entry.clearedAt < 0)) throw new Error('잘못된 클리어 시간');
  for (const r of [...Object.values(entry.records), ...(entry.clearRecord ? [entry.clearRecord] : [])]) if (!r || !Number.isFinite(r.total) || r.total <= 0 || !Array.isArray(r.laps) || !r.laps.length || r.laps.some(n => !Number.isFinite(n) || n <= 0) || !Number.isInteger(r.rank) || r.rank < 1 || r.rank > RACE_PARTICIPANT_COUNT || typeof r.assisted !== 'boolean') throw new Error('잘못된 캠페인 랩 기록');
  if (entry.stars !== undefined && (!Number.isInteger(entry.stars) || entry.stars < 0 || entry.stars > 3 || (entry.stars > 0 && !entry.cleared))) throw new Error('잘못된 별점');
}

/** Legacy saves belong to the normal challenge; unlocks remain shared across challenges. */
export function campaignDifficultyProgress(progress: CampaignProgress, mode: RaceMode, track: TrackDefinition, challenge: RaceChallengeId = 'normal'): CampaignDifficultyProgress | undefined {
  const entry = progress.modes[mode][track.id];
  if (!entry) return undefined;
  if (entry.difficulties?.[challenge]) return entry.difficulties[challenge];
  return challenge === 'normal' && !entry.difficulties ? entry : undefined;
}
export function campaignStars(progress: CampaignProgress, mode: RaceMode, track: TrackDefinition, challenge: RaceChallengeId = 'normal') {
  const entry = campaignDifficultyProgress(progress, mode, track, challenge);
  if (entry?.stars !== undefined) return entry.stars;
  const clear = campaignClearRecord(progress, mode, track, challenge);
  return clear ? Math.max(1, challengeStars(mode, track, challenge, { ...clear, disqualified: false })) : entry?.cleared ? 1 : 0;
}
export function validateCampaign(value: unknown): CampaignProgress {
  if (!value || typeof value !== 'object') throw new Error('잘못된 캠페인 저장 데이터');
  const c = structuredClone(value) as CampaignProgress;
  c.knownTracks ??= TRACK_CATALOG.map(t => t.id);
  if (!Array.isArray(c.knownTracks) || c.knownTracks.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id))) throw new Error('잘못된 트랙 목록');
  if (c.last?.challenge !== undefined && raceChallenge(c.last.challenge) !== c.last.challenge) throw new Error('잘못된 난이도');
  if (!c.modes || !c.last || !['time-attack', 'competition'].includes(c.last.mode) || typeof c.last.trackId !== 'string') throw new Error('잘못된 캠페인 저장 데이터');
  for (const mode of ['time-attack', 'competition'] as const) {
    const data = c.modes[mode];
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('잘못된 캠페인 진행 기록');
    // Keep unknown/retired track IDs: later releases may restore them.
    for (const [id, entry] of Object.entries(data)) {
      if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('잘못된 트랙 ID');
      validateEntry(entry);
      if (entry.difficulties !== undefined) {
        if (!entry.difficulties || typeof entry.difficulties !== 'object' || Array.isArray(entry.difficulties)) throw new Error('잘못된 난이도 기록');
        for (const [key, difficulty] of Object.entries(entry.difficulties)) {
          if (raceChallenge(key) !== key) throw new Error('잘못된 난이도');
          validateEntry(difficulty);
        }
      }
    }
  }
  return structuredClone(c);
}
export interface CampaignOutcome {
  mode: RaceMode; trackId: string; revision: number; total: number; laps: number[];
  rank: number; disqualified: boolean; assisted: boolean; lapLimit: number; challenge?: RaceChallengeId;
}
/** Unlocks and records are written by the same transaction as the race reward. */
export function completeCampaign(progress: CampaignProgress, outcome: CampaignOutcome) {
  const track = TRACK_CATALOG.find(t => t.id === outcome.trackId);
  if (!track || track.revision !== outcome.revision || !['time-attack', 'competition'].includes(outcome.mode)
    || !Number.isFinite(outcome.total) || outcome.total <= 0 || !Number.isFinite(outcome.lapLimit) || outcome.lapLimit <= 0
    || !Number.isInteger(outcome.rank) || outcome.rank < 1 || outcome.rank > RACE_PARTICIPANT_COUNT || typeof outcome.disqualified !== 'boolean' || typeof outcome.assisted !== 'boolean'
    || !Array.isArray(outcome.laps) || outcome.laps.some(n => !Number.isFinite(n) || n <= 0)) throw new Error('잘못된 캠페인 결과');
  const challenge = raceChallenge(outcome.challenge);
  if (outcome.challenge !== undefined && outcome.challenge !== challenge) throw new Error('잘못된 난이도');
  const allowedLimit = challengeLapLimit(track, challenge);
  if (outcome.mode === 'time-attack' && outcome.lapLimit !== allowedLimit) throw new Error('잘못된 랩 제한시간');
  if (outcome.laps.length > track.laps || (!outcome.disqualified && (outcome.laps.length !== track.laps || Math.abs(outcome.laps.reduce((a, b) => a + b, 0) - outcome.total) > .003))) throw new Error('잘못된 랩 합계');
  if (campaignStatus(progress, outcome.mode, track) === 'locked') throw new Error('아직 도전할 수 없는 트랙입니다.');
  const entry = progress.modes[outcome.mode][track.id] ??= { cleared: false, attempts: 0, records: {} };
  // Preserve a recoverable legacy winning result before a faster replay replaces it.
  entry.clearRecord ??= campaignClearRecord(progress, outcome.mode, track);
  if (!entry.difficulties) {
    const legacy: CampaignDifficultyProgress = { cleared: entry.cleared, attempts: entry.attempts, records: structuredClone(entry.records), clearRecord: entry.clearRecord, clearedAt: entry.clearedAt, stars: campaignStars(progress, outcome.mode, track, 'normal') };
    entry.difficulties = { normal: legacy };
  }
  const difficulty = entry.difficulties[challenge] ??= { cleared: false, attempts: 0, records: {}, stars: 0 };
  entry.attempts++; difficulty.attempts++;
  const passed = !outcome.disqualified && outcome.laps.length === track.laps && (outcome.mode === 'competition' ? outcome.rank <= campaignRankLimit(track) : outcome.laps.every(lap => lap <= allowedLimit));
  const firstClear = passed && !entry.cleared;
  const stars = challengeStars(outcome.mode, track, challenge, outcome);
  difficulty.stars = Math.max(difficulty.stars ?? 0, stars);
  if (passed) {
    difficulty.cleared = true; difficulty.clearedAt ??= Date.now();
    // Keep the strongest passing result for the comparison table, independently of fastest total.
    if (!difficulty.clearRecord || stars > challengeStars(outcome.mode, track, challenge, { ...difficulty.clearRecord, disqualified: false }) || (stars === challengeStars(outcome.mode, track, challenge, { ...difficulty.clearRecord, disqualified: false }) && outcome.total < difficulty.clearRecord.total)) difficulty.clearRecord = { revision: track.revision, total: outcome.total, laps: [...outcome.laps], rank: outcome.rank, assisted: outcome.assisted };
    entry.cleared = true; entry.clearedAt ??= Date.now();
    entry.clearRecord ??= { revision: track.revision, total: outcome.total, laps: [...outcome.laps], rank: outcome.rank, assisted: outcome.assisted };
  }
  if (!outcome.disqualified && outcome.laps.length === track.laps) {
    const key = `${track.revision}:${outcome.assisted ? 'assisted' : 'normal'}`;
    if (!difficulty.records[key] || difficulty.records[key].total > outcome.total) difficulty.records[key] = { total: outcome.total, laps: [...outcome.laps], rank: outcome.rank, assisted: outcome.assisted };
    if (challenge === 'normal') entry.records[key] = structuredClone(difficulty.records[key]);
  }
  return { passed, firstClear, stars, bonus: firstClear ? 100 + track.rating * 25 : 0 };
}

/** Older saves have no dedicated clear record: only show a verifiable passing result. */
export function campaignClearRecord(progress: CampaignProgress, mode: RaceMode, track: TrackDefinition, challenge?: RaceChallengeId): CampaignClearRecord | undefined {
  const entry = challenge === undefined ? progress.modes[mode][track.id] : campaignDifficultyProgress(progress, mode, track, challenge);
  if (!entry?.cleared) return undefined;
  if (entry.clearRecord) return entry.clearRecord;
  for (const [key, record] of Object.entries(entry.records)) {
    const revision = Number(key.split(':')[0]);
    if (!Number.isSafeInteger(revision) || revision < 1 || record.laps.length !== track.laps) continue;
    if (mode === 'competition' ? record.rank === 1 : revision === track.revision && record.laps.every(lap => lap <= challengeLapLimit(track, challenge ?? 'normal'))) return { ...record, revision };
  }
  return undefined;
}
