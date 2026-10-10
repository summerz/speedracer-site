import * as THREE from 'three';
import { createTrackFrame, type Track } from './createTrack.js';
import { defaultBranchRoute, type TrackFork } from './trackBranches.js';

/** One hue per route slot (left / center / right); shared by lane paint, sign panels and the HUD. */
export const LANE_HUES = { left: '#7cf3ff', center: '#fff0a0', right: '#ff9ad5' } as const;
export type LaneSlot = keyof typeof LANE_HUES;

/** Slot of each route in left-to-right order: 3-way = L/C/R, 2-way = L/R. */
export const laneSlots = (fork: TrackFork): LaneSlot[] => fork.routes.length === 3 ? ['left', 'center', 'right'] : ['left', 'right'];

/** Lateral selection boundaries, mirroring selectBranch: arena-three uses ±0.3·halfWidth, legacy 2-way uses offset 0.4. */
export function laneBoundaries(track: Pick<Track, 'halfWidth'>, fork: TrackFork): number[] {
  return fork.routes.length === 3 ? [-.3 * track.halfWidth, .3 * track.halfWidth] : [.4];
}

const LEAD_IN = 60, SPACING = 12, ROUTE_RUN = 80, LIFT = .08;
const SLOT_ANGLE: Record<LaneSlot, number> = { left: -.5, center: 0, right: .5 };

/** Painted lane dividers and route-coloured chevrons on the shared fork mouth, plus a short chevron run on each branch. Horizontal forks only. */
export function createForkLanes(track: Track, fork: TrackFork): THREE.Mesh | null {
  if (fork.kind !== 'horizontal' || fork.routes.length < 2 || fork.routes.length > 3) return null;
  const slots = laneSlots(fork), bounds = laneBoundaries(track, fork), hw = track.halfWidth;
  const edges = [-hw, ...bounds, hw];
  const entrance = fork.start + fork.junctionLength, defaultId = defaultBranchRoute(fork).id;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const frame = createTrackFrame(), p = new THREE.Vector3(), tmp = new THREE.Vector3();
  const c = new THREE.Color();
  // Local quad/polygon in (lateral x, forward z) metres around a centre, rotated by angle (+ = toward right).
  const poly = (centre: THREE.Vector3, angle: number, pts: [number, number][], color: string, alpha: number) => {
    const base = pos.length / 3, sin = Math.sin(angle), cos = Math.cos(angle);
    c.set(color).multiplyScalar(.85);
    for (const [x, z] of pts) {
      tmp.copy(centre).addScaledVector(frame.right, x * cos + z * sin).addScaledVector(frame.tangent, z * cos - x * sin).addScaledVector(frame.up, LIFT);
      pos.push(tmp.x, tmp.y, tmp.z); col.push(c.r, c.g, c.b, alpha);
    }
    if (pts.length === 6) idx.push(base, base + 1, base + 4, base, base + 4, base + 5, base + 1, base + 2, base + 3, base + 1, base + 3, base + 4); // V: two arms
    else for (let i = 1; i < pts.length - 1; i++) idx.push(base, base + i, base + i + 1);
  };
  const chevron = (centre: THREE.Vector3, slot: LaneSlot, alpha: number, scale = 1) => {
    const w = 1.8 * scale, t = .7 * scale, h = 2.2 * scale; // wing half-width, stroke thickness, depth
    // V pointing forward (+z): tip at (0,h), wings trail back.
    poly(centre, SLOT_ANGLE[slot], [[-w, -h], [0, h], [w, -h], [w, -h - t * 1.6], [0, h - t * 2.4], [-w, -h - t * 1.6]].map(([x, z]) => [x, z + .2] as [number, number]), LANE_HUES[slot], alpha);
  };
  const ahead = (d: number) => d < fork.start ? undefined : defaultId;
  // Shared mouth + lead-in: dividers and arrows.
  const from = Math.max(0, fork.start - LEAD_IN);
  for (let d = from; d < entrance; d += 4) {
    const fade = d < fork.start ? .35 + .65 * (d - from) / LEAD_IN : 1;
    track.sample(d, frame, ahead(d));
    for (const b of bounds) { // dashed divider, 2.4 m dash every 4 m + gap
      p.copy(frame.position).addScaledVector(frame.right, b).addScaledVector(frame.tangent, 1.2);
      poly(p, 0, [[-.14, -1.2], [.14, -1.2], [.14, 1.2], [-.14, 1.2]], '#ffffff', .8 * fade);
    }
  }
  for (let d = from + SPACING / 2; d < entrance - 6; d += SPACING) {
    const fade = d < fork.start ? .35 + .65 * (d - from) / LEAD_IN : 1;
    track.sample(d, frame, ahead(d));
    slots.forEach((slot, i) => {
      p.copy(frame.position).addScaledVector(frame.right, (edges[i] + edges[i + 1]) / 2);
      chevron(p, slot, .9 * fade);
    });
  }
  // Each branch: the same hue continues just after the split.
  fork.routes.forEach((route, i) => {
    for (let d = entrance + 6; d < Math.min(entrance + ROUTE_RUN, fork.end - fork.junctionLength); d += SPACING) {
      track.sample(d, frame, route.id);
      chevron(p.copy(frame.position), slots[i], .9 * (1 - .6 * (d - entrance) / ROUTE_RUN));
    }
  });
  if (!idx.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geometry.setIndex(idx);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  mesh.name = `fork-lanes-${fork.id}`; mesh.frustumCulled = false; mesh.renderOrder = 1;
  return mesh;
}
