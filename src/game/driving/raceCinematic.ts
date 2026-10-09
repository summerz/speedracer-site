/** Pure timing and copy for the race intro and finish cinematics; no DOM or three.js. */
export const INTRO_SECONDS = 5, INTRO_REDUCED_SECONDS = 1.5;
export const FINISH_SECONDS = 1.6, FINISH_REDUCED_SECONDS = 1;
export const SLOWMO_SECONDS = .8, SLOWMO_SCALE = .25, SWING_SECONDS = 1.2;

export type CinematicKind = 'intro' | 'finish';
/** The intro is the flythrough (`INTRO_SECONDS`) followed by the start-grid showcase; `rivals` only matters for the showcase. */
export const cinematicSeconds = (kind: CinematicKind, reduced: boolean, rivals = 0) =>
  kind === 'intro' ? reduced ? INTRO_REDUCED_SECONDS : INTRO_SECONDS + showcasePlan(rivals, false).total : reduced ? FINISH_REDUCED_SECONDS : FINISH_SECONDS;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Smootherstep: zero velocity and acceleration at both ends. */
export const ease = (u: number) => { const x = clamp01(u); return x * x * x * (x * (x * 6 - 15) + 10); };
/** Eased 0..1 progress of the intro flythrough. */
export const introProgress = (seconds: number, duration = INTRO_SECONDS) => ease(seconds / duration);
/** Real-time to simulation scale for rivals and effects after the player finishes. */
export const finishTimeScale = (seconds: number, reduced: boolean) => !reduced && seconds < SLOWMO_SECONDS ? SLOWMO_SCALE : 1;
/** Chase camera (directly behind) swings around the right side to a front three-quarter view. */
export function finishSwing(seconds: number, reduced: boolean) {
  const u = reduced ? 0 : ease(seconds / SWING_SECONDS);
  return { azimuth: Math.PI + (.87 - Math.PI) * u, radius: 8.5 - .5 * u, height: 3.5 - 1.3 * u };
}

export const SHOWCASE_PLAYER_ATTACK = 2.2, SHOWCASE_PLAYER_COMPETITION = 2, SHOWCASE_RIVAL = .7, SHOWCASE_MAX = 6.5, SHOWCASE_BLEND = .5;
/** `index` is 0 for the player and the grid-order rival index (nearest first) for rivals. */
export interface ShowcaseShot { kind: 'player' | 'rival'; index: number; start: number; duration: number }
export interface ShowcasePlan { shots: ShowcaseShot[]; total: number }
/** Cuts on the start grid: the player first, then the nearest rivals while they fit under `SHOWCASE_MAX`. Reduced motion has none. */
export function showcasePlan(rivalCount: number, reduced: boolean): ShowcasePlan {
  if (reduced) return { shots: [], total: 0 };
  const count = Math.max(0, Math.floor(rivalCount)), first = count ? SHOWCASE_PLAYER_COMPETITION : SHOWCASE_PLAYER_ATTACK;
  const shots: ShowcaseShot[] = [{ kind: 'player', index: 0, start: 0, duration: first }];
  const fit = Math.min(count, Math.floor((SHOWCASE_MAX - first) / SHOWCASE_RIVAL + 1e-9));
  for (let i = 0; i < fit; i++) shots.push({ kind: 'rival', index: i, start: first + i * SHOWCASE_RIVAL, duration: SHOWCASE_RIVAL });
  const last = shots[shots.length - 1];
  return { shots, total: last.start + last.duration };
}
export interface ShowcaseAt { shot: number; u: number; blend: number }
/** Shot number (into `plan.shots`), 0..1 progress inside it, and 0..1 blend into the chase camera over the final `SHOWCASE_BLEND`. */
export function showcaseAt(plan: ShowcasePlan, t: number, out: ShowcaseAt = { shot: 0, u: 0, blend: 0 }): ShowcaseAt | null {
  if (!plan.shots.length) return null;
  let i = plan.shots.length - 1;
  while (i > 0 && t < plan.shots[i].start) i--;
  const shot = plan.shots[i];
  out.shot = i; out.u = clamp01((t - shot.start) / shot.duration); out.blend = ease((t - (plan.total - SHOWCASE_BLEND)) / SHOWCASE_BLEND);
  return out;
}
/** What the UI labels while a showcase shot is on screen. */
export interface CinematicShot { kind: 'player' | 'rival'; name: string; color?: string; detail?: string; index: number; total: number }

export const REPLAY_SHOTS = 3;
/** Slice of the recording each shot plays (the trackside shot skips the far approach); the shot still lasts one full slot. */
export const REPLAY_RANGES: readonly (readonly [number, number])[] = [[.4, 1], [0, 1], [0, 1]];
/** Finish replay: each camera shot gets one slot of `length`, hard cut between shots, then repeat. `u` is progress in the slot, `v` the recording position (0..1) to show. */
export function replayShot(elapsed: number, length: number, out: { shot: 0 | 1 | 2; u: number; v: number } = { shot: 0, u: 0, v: 0 }) {
  const pass = Math.floor(Math.max(0, elapsed) / Math.max(length, 1e-6));
  out.shot = (pass % REPLAY_SHOTS) as 0 | 1 | 2; out.u = clamp01(Math.max(0, elapsed) / Math.max(length, 1e-6) - pass);
  const [from, to] = REPLAY_RANGES[out.shot]; out.v = from + (to - from) * out.u;
  return out;
}

export function ordinal(rank: number) {
  const n = Math.max(1, Math.floor(rank)), tens = n % 100;
  return `${n}${tens >= 11 && tens <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH'}`;
}

export interface FinishSplash { kind: 'best' | 'rank' | 'finish' | 'muted'; title: string; detail: string; badge: string }
/** `rank` is set only in competition. A disqualified run is always muted, even if it beat a record. */
export function finishSplash(input: { rank: number | null; disqualified: boolean; isNewBest: boolean; total: string }): FinishSplash {
  if (input.disqualified) return { kind: 'muted', title: 'FINISH', detail: input.total, badge: '' };
  const title = input.rank === null ? 'FINISH' : ordinal(input.rank);
  const detail = input.rank === null ? input.total : '';
  return { kind: input.isNewBest ? 'best' : input.rank === null ? 'finish' : 'rank', title, detail, badge: input.isNewBest ? 'NEW BEST' : '' };
}

export interface IntroTitle { eyebrow: string; name: string; meta: string[] }
export function introTitle(input: { district?: string; order?: number; name: string; difficulty: string; laps: number; field?: number }): IntroTitle {
  const eyebrow = input.district ? `${input.district} · ${String(input.order ?? 0).padStart(2, '0')}` : '시험 주행';
  return { eyebrow, name: input.name, meta: [input.difficulty, `${input.laps}랩`, ...input.field ? [`${input.field}대 출전`] : []] };
}
