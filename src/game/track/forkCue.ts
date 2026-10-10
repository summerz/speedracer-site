import type { Track } from './createTrack.js';
import { branchChoiceOpen, defaultBranchRoute, forkAt, physicalDistance, selectBranch, upcomingFork, type TrackFork } from './trackBranches.js';

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
}
export interface ForkCuePose {
  readonly distance: number;
  readonly offset: number;
  readonly altitudeLevel: number;
  readonly routeId?: string | null;
  readonly speed: number;
}

export function forkRouteCues(fork: TrackFork): readonly ForkRouteCue[] {
  return fork.routes.flatMap(route => route.cue ? [{ id: route.id, name: route.name, ...route.cue, features: route.features, length: route.length }] : []);
}

/** New HUD pilot only; existing forks keep their legacy cue until their visuals are migrated. */
export function readForkCue(track: Track, pose: ForkCuePose): ForkCue | null {
  const fork = forkAt(track, pose.distance) ?? upcomingFork(track, pose.distance, Math.max(180, pose.speed * 2.5));
  if (!fork?.authoredLayout) return null;
  const local = ((pose.distance % track.length) + track.length) % track.length;
  const phase = local < fork.start ? 'approach' : branchChoiceOpen(track, pose.distance) ? 'choice' : 'route';
  const fallback = defaultBranchRoute(fork).id;
  const selected = phase === 'route' ? fork.routes.find(r => r.id === pose.routeId)?.id ?? fallback : null;
  const preview = selected ?? selectBranch(track, Math.max(fork.start, local), pose.offset, pose.altitudeLevel) ?? fallback;
  const boundary = phase === 'approach' ? fork.start : phase === 'choice' ? fork.start + fork.junctionLength : fork.end;
  return { id: fork.id, kind: fork.kind, phase, routes: forkRouteCues(fork), defaultRouteId: fallback,
    previewRouteId: preview, selectedRouteId: selected,
    distance: physicalDistance(track, pose.distance, boundary - local, preview) };
}
