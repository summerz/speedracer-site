import { DRONE_CATALOG } from '../drone/droneCatalog.js';
import { trackDefinition } from '../track/trackCatalog.js';
import { challengeLapLimit, type RaceChallengeId } from '../track/raceChallenge.js';
import { raceEnvironmentsForDistrict, type RaceEnvironmentId, type RainIntensity } from '../environment/raceEnvironment.js';
import { RACE_RULES_VERSION } from '../driving/raceProgress.js';

export const DAILY_REWARD = 150;
export const DAILY_SELECTION_VERSION = 'daily-v1';
export const DAILY_CRAFT_IDS = Object.freeze(['catamaran', 'dr-01', 'halo', 'hammerhead', 'needle']);
export const DAILY_TRACK_IDS = Object.freeze(['arena-ring', 'block-sprint', 'coil-foundry', 'gridworks', 'victory-loop', 'window-run']);
const DAY = 86_400_000, KST = 9 * 3_600_000;
export type DailyGoalId = 'boost' | 'safe-pass' | 'drift';
export interface DailyGoal { id: DailyGoalId; target: number }
export interface DailyChallenge {
  dateKey: string; challengeId: string; seed: number; trackId: string; trackRevision: number;
  craftId: string; challenge: RaceChallengeId; mode: 'time-attack'; laps: number;
  environmentId: RaceEnvironmentId; rainIntensity: RainIntensity; rewardPoints: number; goal: DailyGoal;
}
export interface DailyCounters { boost: number; safePass: number; drift: number }
export interface DailyRunRecord {
  challengeId: string; raceId: string; total: number; laps: number[]; recordedAt: string;
  controlMode: 'touch' | 'keyboard' | 'gamepad';
}
export interface DailyProgress { bests: Record<string, DailyRunRecord>; receipts: Record<string, string> }
export interface DailySnapshot {
  challenge: DailyChallenge; status: 'ready' | 'running' | 'success' | 'failed';
  current: number; target: number; done: boolean; best: DailyRunRecord | null;
  rewardClaimed: boolean; nextDayInSeconds: number;
}
export interface DailyResultInput {
  challenge: DailyChallenge; raceId: string; laps: number[]; counters: DailyCounters;
  disqualified: boolean; recordedAt: string; controlMode: DailyRunRecord['controlMode'];
}
export interface DailySettlement {
  success: boolean; awarded: number; rewardClaimed: boolean; isNewBest: boolean; best: DailyRunRecord | null;
}
export const emptyDailyProgress = (): DailyProgress => ({ bests: {}, receipts: {} });
export function dailyDateKey(nowMs = Date.now()): string {
  if (!Number.isFinite(nowMs) || !Number.isFinite(new Date(nowMs + KST).getTime())) throw new Error('잘못된 날짜');
  const key = new Date(nowMs + KST).toISOString().slice(0, 10); validateDate(key); return key;
}
function validateDate(key: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(Date.parse(key)) || new Date(key).toISOString().slice(0, 10) !== key) throw new Error('잘못된 도전 날짜');
}
function hash(text: string) {
  let seed = 2166136261;
  for (const byte of new TextEncoder().encode(text)) seed = Math.imul(seed ^ byte, 16777619);
  return seed >>> 0;
}
export function dailyChallengeFor(dateKey: string): DailyChallenge {
  validateDate(dateKey);
  const prefix = `${DAILY_SELECTION_VERSION}:${dateKey}`;
  const choose = <T>(stream: string, values: readonly T[]) => values[hash(`${prefix}:${stream}`) % values.length];
  const trackId = choose('track', DAILY_TRACK_IDS), track = trackDefinition(trackId)!;
  const craftId = choose('craft', DAILY_CRAFT_IDS), craft = DRONE_CATALOG.find(entry => entry.configuration.id === craftId)!;
  const challenge = choose('difficulty', ['easy', 'normal'] as const);
  const goals = [{ id: 'boost', target: 3 }, { id: 'safe-pass', target: 3 }, { id: 'drift', target: 1 }] as const;
  const goal = goals[((Math.floor(Date.parse(dateKey) / DAY) % 3) + 3) % 3];
  const environmentId = choose('environment', [...raceEnvironmentsForDistrict(track.district)].sort((a, b) => a.id.localeCompare(b.id))).id;
  const spec = { dateKey, seed: hash(prefix), trackId, trackRevision: track.revision, craftId: craft.configuration.id,
    challenge, mode: 'time-attack' as const, laps: track.laps, environmentId,
    rainIntensity: choose('rain', ['light', 'moderate', 'heavy'] as const), rewardPoints: DAILY_REWARD, goal };
  return { ...spec, challengeId: `${prefix}:${hash(JSON.stringify([spec, RACE_RULES_VERSION, craft.configuration.performance])).toString(16)}` };
}
/** Reset this generator for each attempt, including retries of the same session. */
export function dailyObstacleRandom(challenge: DailyChallenge): () => number {
  let seed = hash(`${challenge.challengeId}:obstacles`);
  return () => { seed = (seed + 0x6D2B79F5) >>> 0; let n = Math.imul(seed ^ seed >>> 15, 1 | seed); n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
export function dailyGoalCurrent(challenge: DailyChallenge, counters: DailyCounters): number {
  return counters[challenge.goal.id === 'safe-pass' ? 'safePass' : challenge.goal.id];
}
export function dailySnapshot(profile: { daily: DailyProgress }, challenge: DailyChallenge, nowMs = Date.now()): DailySnapshot {
  const best = profile.daily.bests[challenge.dateKey];
  return { challenge: structuredClone(challenge), status: 'ready', current: 0, target: challenge.goal.target, done: false,
    best: best?.challengeId === challenge.challengeId ? structuredClone(best) : null,
    rewardClaimed: Object.hasOwn(profile.daily.receipts, challenge.dateKey),
    nextDayInSeconds: Math.max(0, Math.ceil((Date.parse(challenge.dateKey) - KST + DAY - nowMs) / 1000)) };
}
export function dailyResultSucceeded(input: DailyResultInput): boolean {
  const track = trackDefinition(input.challenge.trackId)!;
  return !input.disqualified && input.laps.length === input.challenge.laps && input.laps.every(lap => lap <= challengeLapLimit(track, input.challenge.challenge))
    && dailyGoalCurrent(input.challenge, input.counters) >= input.challenge.goal.target;
}
/** Pure settlement; the profile store runs this inside the wallet's read/write transaction. */
export function settleDailyResult(current: DailyProgress, input: DailyResultInput): { daily: DailyProgress; settlement: DailySettlement } {
  const canonical = dailyChallengeFor(input.challenge.dateKey);
  if (Object.keys(input.challenge).length !== Object.keys(canonical).length || Object.entries(canonical).some(([key, value]) => key === 'goal' ? input.challenge.goal?.id !== canonical.goal.id || input.challenge.goal?.target !== canonical.goal.target : input.challenge[key as keyof DailyChallenge] !== value)) throw new Error('오늘의 도전 명세가 일치하지 않습니다. 다시 진입해주세요.');
  if (!validId(input.raceId) || !validTimestamp(input.recordedAt) || !['touch', 'keyboard', 'gamepad'].includes(input.controlMode)
    || typeof input.disqualified !== 'boolean' || !Array.isArray(input.laps) || input.laps.length > canonical.laps
    || !input.laps.every(positiveTime) || input.laps.reduce((a, b) => a + b, 0) >= 86400
    || !input.counters || !['boost', 'safePass', 'drift'].every(key => Number.isSafeInteger(input.counters[key as keyof DailyCounters]) && input.counters[key as keyof DailyCounters] >= 0)) throw new Error('잘못된 도전 결과');
  const daily = validateDailyProgress(current), success = dailyResultSucceeded(input);
  const previous = daily.bests[canonical.dateKey];
  const sameSpec = previous?.challengeId === canonical.challengeId;
  const total = input.laps.reduce((a, b) => a + b, 0);
  const isNewBest = success && (!sameSpec || total < previous.total - 1e-8);
  const awarded = success && !Object.hasOwn(daily.receipts, canonical.dateKey) ? DAILY_REWARD : 0;
  if (awarded) daily.receipts[canonical.dateKey] = input.raceId;
  if (isNewBest) daily.bests[canonical.dateKey] = { challengeId: canonical.challengeId, raceId: input.raceId, total, laps: [...input.laps], recordedAt: input.recordedAt, controlMode: input.controlMode };
  // Keep 30 detailed days; receipts survive pruning and build/rule changes.
  const keys = Object.keys(daily.bests).sort(); for (const key of keys.slice(0, Math.max(0, keys.length - 30))) delete daily.bests[key];
  return { daily, settlement: { success, awarded, rewardClaimed: Object.hasOwn(daily.receipts, canonical.dateKey), isNewBest,
    best: structuredClone(daily.bests[canonical.dateKey]?.challengeId === canonical.challengeId ? daily.bests[canonical.dateKey] : null) } };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const validId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const validTimestamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const positiveTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 86400;
export function validateDailyProgress(value: unknown): DailyProgress {
  if (!object(value) || !object(value.bests) || !object(value.receipts)) throw new Error('잘못된 도전 저장 데이터');
  for (const [key, v] of Object.entries(value.receipts)) { validateDate(key); if (!validId(v)) throw new Error('잘못된 도전 영수증'); }
  for (const [key, v] of Object.entries(value.bests)) {
    validateDate(key);
    if (!object(v) || !validId(v.challengeId) || !validId(v.raceId) || !positiveTime(v.total) || !Array.isArray(v.laps) || !v.laps.length || v.laps.length > 10 || !v.laps.every(positiveTime)
      || Math.abs(v.laps.reduce((a, b) => a + b, 0) - v.total) > 1e-6 || !validTimestamp(v.recordedAt) || !['touch', 'keyboard', 'gamepad'].includes(v.controlMode as string)) throw new Error('잘못된 도전 최고 기록');
  }
  return structuredClone(value) as unknown as DailyProgress;
}
export const dailyChallengeHash = () => '#drive?daily=1';
