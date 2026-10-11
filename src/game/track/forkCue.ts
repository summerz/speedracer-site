import type { Track } from './createTrack.js';
import { FORK_PREVIEW_MAX } from './forkDecisionSafety.js';
import { branchChoiceOpen, defaultBranchRoute, forkAt, physicalDistance, selectBranch, upcomingFork, verticalThreshold, type TrackFork } from './trackBranches.js';

export type ForkChoice = 'left' | 'center' | 'right' | 'lower' | 'upper';
export type ForkRoadHeight = 'low' | 'middle' | 'high' | 'variable';
export type ForkHazard = 'height' | 'corridor';
export interface ForkRouteCue {
  readonly id: string;
  readonly name: string;
  readonly choice: ForkChoice;
  readonly roadHeight: ForkRoadHeight;
  readonly hazards: readonly ForkHazard[];
  readonly features: readonly string[];
  readonly length: number;
  /** Displayed (1-based) altitude range that selects this route. */
  readonly altitudeHint?: string;
}
export interface ForkCue {
  readonly id: string;
  readonly kind: 'horizontal' | 'vertical';
  readonly phase: 'approach' | 'choice' | 'route';
  readonly routes: readonly ForkRouteCue[];
  readonly defaultRouteId: string;
  readonly previewRouteId: string;
  readonly selectedRouteId: string | null;
  /** Physical metres to entry, selection deadline, or merge end, depending on phase. */
  readonly distance: number;
  /** Metres to the exact branchChoiceOpen boundary, including approach plus junction. */
  readonly selectionDistance: number;
  /** Estimate at current speed in simulation seconds; null when stopped or locked. */
  readonly selectionSeconds: number | null;
}
export interface ForkCuePose {
  readonly distance: number;
  readonly offset: number;
  readonly altitudeLevel: number;
  readonly routeId?: string | null;
  readonly speed: number;
}

export function forkRouteCues(fork: TrackFork, track?: Track): readonly ForkRouteCue[] {
  return fork.routes.map((route, index) => {
    const vertical = fork.kind === 'vertical';
    const choice: ForkChoice = vertical ? (index ? 'upper' : 'lower') : fork.routes.length === 3 ? (['left', 'center', 'right'] as const)[index] : index ? 'right' : 'left';
    const hazards: ForkHazard[] = [];
    if (track?.heightObstacles.some(o => o.routeId === route.id)) hazards.push('height');
    if (track?.corridorObstacles?.some(o => o.routeId === route.id)) hazards.push('corridor');
    const fallback = { choice, roadHeight: vertical ? (index ? 'high' : 'low') : 'variable', hazards } as const;
    const threshold = track ? verticalThreshold(track) : 0;
    const altitudeHint = vertical && track ? index ? `${threshold + 1}단 이상` : threshold === 1 ? '1단' : `1–${threshold}단` : undefined;
    const features = track?.jumps?.some(j => j.routeId === route.id) ? [...route.features, '하강 점프'] : route.features;
    return { id: route.id, name: route.name, ...(route.cue ?? fallback), features, length: route.length, ...(altitudeHint ? { altitudeHint } : {}) };
  });
}

/** Every fork uses the same preview, input instructions, and locked-route guide. */
export function readForkCue(track: Track, pose: ForkCuePose): ForkCue | null {
  const active = forkAt(track, pose.distance);
  const fork = active ?? upcomingFork(track, pose.distance, Math.min(FORK_PREVIEW_MAX, Math.max(180, pose.speed * 2.5)));
  if (!fork) return null;
  const local = ((pose.distance % track.length) + track.length) % track.length;
  const phase = !active ? 'approach' : branchChoiceOpen(track, pose.distance) ? 'choice' : 'route';
  const fallback = defaultBranchRoute(fork).id;
  const selected = phase === 'route' ? fork.routes.find(r => r.id === pose.routeId)?.id ?? fallback : null;
  const preview = selected ?? selectBranch(track, active ? local : fork.start, pose.offset, pose.altitudeLevel) ?? fallback;
  const boundary = phase === 'approach' ? fork.start : phase === 'choice' ? fork.start + fork.junctionLength : fork.end;
  const gap = phase === 'approach' ? (boundary - local + track.length) % track.length : boundary - local;
  const selectionGap = phase === 'approach' ? gap + fork.junctionLength : phase === 'choice' ? gap : 0;
  const selectionDistance = physicalDistance(track, pose.distance, selectionGap, preview);
  return { id: fork.id, kind: fork.kind, phase, routes: forkRouteCues(fork, track), defaultRouteId: fallback,
    previewRouteId: preview, selectedRouteId: selected,
    distance: physicalDistance(track, pose.distance, gap, preview), selectionDistance,
    selectionSeconds: phase !== 'route' && pose.speed > .5 ? selectionDistance / pose.speed : null };
}

/** Shared by the HUD and roadside panel; never displays zero before the choice locks. */
export function forkCountdownText(cue: ForkCue): string {
  if (cue.phase === 'route') return '✓ 경로 확정';
  return cue.selectionSeconds === null ? '선택 대기' : `확정까지 ${Math.max(.1, Math.ceil(cue.selectionSeconds * 10) / 10).toFixed(1)}초`;
}
