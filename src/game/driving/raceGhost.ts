import type { RecordStorage } from './raceRecords.js';

/** Best-run ghost: 10 Hz samples of [t, distance, offset, altitude, heading, routeIndex], 2-decimal quantized. */
export const GHOST_VERSION = 1, GHOST_HZ = 10, GHOST_MAX_BYTES = 150_000;
export type GhostSample = readonly [t: number, distance: number, offset: number, altitude: number, heading: number, route: number];
export interface Ghost { v: number; total: number; routes: string[]; s: GhostSample[] }
export interface GhostPose { distance: number; offset: number; altitude: number; heading: number; routeId: string | null; finished: boolean }
interface GhostState { elapsed: number; distance: number; offset: number; altitude: number; heading: number; routeId?: string | null }

export const ghostKey = (trackId: string, challenge: string) => `speedracer-ghost:${trackId}:${challenge}`;
export const quantize = (n: number) => Math.round(n * 100) / 100;

export function createGhostRecorder(hz = GHOST_HZ) {
  let s: GhostSample[] = [], routes: string[] = [], last = -Infinity;
  const push = (st: GhostState, t: number, distance: number) => {
    const id = st.routeId ?? '';
    let route = routes.indexOf(id); if (route < 0) route = routes.push(id) - 1;
    s.push([quantize(t), quantize(distance), quantize(st.offset), quantize(st.altitude), quantize(st.heading), route]);
  };
  return {
    reset() { s = []; routes = []; last = -Infinity; },
    sample(st: GhostState) { if (st.elapsed - last < 1 / hz - 1e-9) return; last = st.elapsed; push(st, st.elapsed, st.distance); },
    /** Closes the run with the interpolated finish crossing, since 10 Hz rarely lands on it. */
    finish(st: GhostState, total: number, distance: number): Ghost { push(st, total, distance); return { v: GHOST_VERSION, total: quantize(total), routes: [...routes], s: [...s] }; },
  };
}

/** Only a clean, completed personal best may overwrite the stored ghost. */
export const shouldSaveGhost = (run: { mode: string; disqualified: boolean; isNewBest: boolean }) =>
  run.mode === 'time-attack' && !run.disqualified && run.isNewBest;

const valid = (g: unknown): g is Ghost => {
  const x = g as Ghost | null;
  if (!x || x.v !== GHOST_VERSION || !Number.isFinite(x.total) || !Array.isArray(x.routes) || !Array.isArray(x.s) || x.s.length < 2) return false;
  return x.s.every((p, i) => Array.isArray(p) && p.length === 6 && p.every(Number.isFinite) && x.routes[p[5]] !== undefined && (i === 0 || p[0] >= x.s[i - 1][0] && p[1] >= x.s[i - 1][1]));
};
export const serializeGhost = (ghost: Ghost) => JSON.stringify(ghost);
export function parseGhost(text: string | null): Ghost | null {
  try { const g = JSON.parse(text ?? 'null'); return valid(g) ? g : null; } catch { return null; }
}
export function loadGhost(storage: RecordStorage | undefined, key: string): Ghost | null {
  try { return parseGhost(storage?.getItem(key) ?? null); } catch { return null; }
}
export function saveGhost(storage: RecordStorage | undefined, key: string, ghost: Ghost): boolean {
  try {
    const text = serializeGhost(ghost);
    if (!storage || text.length > GHOST_MAX_BYTES) return false;
    storage.setItem(key, text); return true;
  } catch { return false; }
}

const bracket = (s: readonly GhostSample[], index: 0 | 1, value: number) => {
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid][index] <= value) lo = mid; else hi = mid; }
  return lo;
};
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/** Ghost race time at the player's cumulative distance; null once the player is past the ghost's finish. */
export function timeAtDistance(ghost: Ghost, distance: number): number | null {
  const s = ghost.s, end = s[s.length - 1];
  if (distance > end[1] + 1e-6) return null;
  if (distance <= s[0][1]) return s[0][0];
  const i = bracket(s, 1, distance), a = s[i], b = s[i + 1], span = b[1] - a[1];
  return span > 1e-9 ? lerp(a[0], b[0], (distance - a[1]) / span) : a[0];
}
/** Positive when behind the ghost. */
export const ghostDelta = (ghost: Ghost, elapsed: number, distance: number) => { const t = timeAtDistance(ghost, distance); return t === null ? null : elapsed - t; };
export const formatDelta = (delta: number) => { const text = Math.abs(delta).toFixed(2); return { text: `${delta < 0 && text !== '0.00' ? '−' : '+'}${text}`, ahead: delta < 0 && text !== '0.00' }; };

export function poseAtTime(ghost: Ghost, t: number): GhostPose {
  const s = ghost.s, end = s[s.length - 1];
  const route = (p: GhostSample) => ghost.routes[p[5]] || null;
  if (t >= end[0]) return { distance: end[1], offset: end[2], altitude: end[3], heading: end[4], routeId: route(end), finished: true };
  const i = bracket(s, 0, Math.max(0, t)), a = s[i], b = s[i + 1], span = b[0] - a[0], f = span > 1e-9 ? Math.min(1, Math.max(0, (t - a[0]) / span)) : 0;
  return { distance: lerp(a[1], b[1], f), offset: lerp(a[2], b[2], f), altitude: lerp(a[3], b[3], f), heading: lerp(a[4], b[4], f), routeId: route(a), finished: false };
}
