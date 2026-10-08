/** Pure timing and copy for the race intro and finish cinematics; no DOM or three.js. */
export const INTRO_SECONDS = 5, INTRO_REDUCED_SECONDS = 1.5;
export const FINISH_SECONDS = 1.6, FINISH_REDUCED_SECONDS = 1;
export const SLOWMO_SECONDS = .8, SLOWMO_SCALE = .25, SWING_SECONDS = 1.2;

export type CinematicKind = 'intro' | 'finish';
export const cinematicSeconds = (kind: CinematicKind, reduced: boolean) =>
  kind === 'intro' ? reduced ? INTRO_REDUCED_SECONDS : INTRO_SECONDS : reduced ? FINISH_REDUCED_SECONDS : FINISH_SECONDS;

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
