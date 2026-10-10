import type { TrackJump } from './trackJump.js';
import { expandObstacleLayout, randomCorridorLanes, randomObstacleAltitudes, randomPadLanes, randomRingSides } from './obstacleLayout.js';
import * as THREE from 'three';
import { createDischargeBarrier } from './createDischargeBarrier.js';
import { altitudeCanPass, resolveAltitudeProfile } from './altitudeProfile.js';
import type { DifficultyPreset } from './difficulty.js';
import type { AltitudeProfile } from './altitudeProfile.js';
import { resolveHeightObstacle, obstacleArrivalTime, corridorCanPass, upcomingCorridor } from './obstacleDynamics.js';
import { createCorridorVisual } from './createCorridorVisual.js';
import { createBoostPadVisual } from './createBoostPadVisual.js';
import { createMineFieldVisual } from './createMineFieldVisual.js';
import { createArcRailVisual } from './createArcRailVisual.js';
import { createBoostRingVisual } from './createBoostRingVisual.js';
import { roadBoundary, roadPaths, routeDistanceScale, verticalThreshold, type TrackFork } from './trackBranches.js';

export interface TrackFrame {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** Lateral steering curvature; loops and helices follow automatically. */
  curvature: number;
  section: 'course' | 'vertical-loop' | 'helix';
  /** Physical metres per shared course metre on the selected branch. */
  distanceScale?: number;
}

export interface HeightObstacle {
  readonly routeId?: string;
  readonly distance: number;
  readonly depth: number;
  readonly kind: 'rise' | 'descend' | 'middle';
  readonly visual: 'discharge-arcs';
  readonly speedRetention: number;
  /** Safe craft-center height above the local road, including craft clearance. */
  readonly minAltitude: number;
  readonly maxAltitude: number;
  readonly motion?: { stepSeconds: number; transitionSeconds: number; phase: number; clearance: number };
}

export interface CorridorObstacle {
  readonly routeId?: string;
  readonly distance: number;
  readonly depth: number;
  readonly safeCenter: number;
  /** Width of the physical opening; collision includes the craft's half width. */
  readonly safeWidth: number;
  readonly lane: 'left' | 'center' | 'right';
  readonly speedRetention: number;
}

/** Vertical discharge columns across the whole road height; `at` is metres from `distance` (the field's start), `offset` is lateral. */
export interface MineField {
  readonly routeId?: string;
  readonly distance: number;
  readonly length: number;
  readonly mines: readonly { at: number; offset: number; radius: number }[];
  /** The guaranteed safe line (lateral offset by `at`), followed by rivals and the feasibility tests. */
  readonly line: readonly { at: number; offset: number }[];
}

/** A boost plate on the road: crossing it inside `|offset - center| <= width / 2` recharges and speeds the craft once per lap. */
export interface BoostPad {
  readonly routeId?: string;
  readonly distance: number;
  readonly lane: 'left' | 'center' | 'right';
  readonly center: number;
  readonly width: number;
  readonly length: number;
}

/** Electrified stunt-section half roads: a segment's danger is `[0, side * halfWidth]`; `at` is metres from `distance` (the rail's start). */
export interface ArcRail {
  readonly routeId?: string;
  readonly distance: number;
  readonly length: number;
  readonly segments: readonly { at: number; length: number; side: -1 | 1 }[];
}

/** A floating reward ring in a stunt section: the craft centre within `radius - .8` of `offset` when crossing `distance` earns a boost. */
export interface BoostRing {
  readonly routeId?: string;
  readonly distance: number;
  readonly offset: number;
  readonly radius: number;
}

export interface Track {
  readonly jumps?: readonly TrackJump[];
  /** Scripted training has no randomly placed awakening pickups. */
  readonly awakeningCoresEnabled?: boolean;
  readonly altitudeProfile: AltitudeProfile;
  readonly sections: readonly { kind: TrackFrame['section']; start: number; end: number }[];
  readonly length: number;
  readonly halfWidth: number;
  readonly checkpointSpacing: number;
  readonly heightObstacles: readonly HeightObstacle[];
  readonly corridorObstacles?: readonly CorridorObstacle[];
  readonly boostPads?: readonly BoostPad[];
  readonly mineFields?: readonly MineField[];
  readonly arcRails?: readonly ArcRail[];
  readonly boostRings?: readonly BoostRing[];
  /** The one boost kind this track uses (set by configureExtraObstacles). */
  readonly boostKind?: 'pad' | 'ring';
  readonly branches?: readonly TrackFork[];
  /** Shared session clock: AI freezes/items must not move the world's openings independently. */
  obstacleTime?: number;
  randomizeObstacles?(random: () => number): void;
  /** Fresh per-run positions and type order with the base layout's per-path counts; set by configureExtraObstacles. */
  rollObstacleLayout?(random: () => number): { heights: HeightObstacle[]; corridors: CorridorObstacle[]; pads: BoostPad[]; mineFields: MineField[]; arcRails: ArcRail[]; boostRings: BoostRing[] };
  sample(distance: number, target?: TrackFrame, routeId?: string | null): TrackFrame;
}

/** Includes the obstacle until the entire craft has cleared its rear face. */
export function upcomingHeightObstacle(track: Track, distance: number, routeId?: string | null) {
  let nearest: { obstacle: HeightObstacle; distance: number } | null = null;
  for (const obstacle of track.heightObstacles) {
    if (obstacle.routeId && obstacle.routeId !== routeId) continue;
    let gap = obstacle.distance - distance;
    const clearance = (obstacle.depth / 2 + 2.2) / routeDistanceScale(track, obstacle.distance, obstacle.routeId);
    gap += Math.ceil((-gap - clearance) / track.length) * track.length;
    if (!nearest || gap < nearest.distance) nearest = { obstacle, distance: gap };
  }
  return nearest;
}

export function createTrackFrame(): TrackFrame {
  return { position: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), curvature: 0, section: 'course' };
}

/** Arc-length sampling keeps distance and speed independent of control-point spacing. */
export interface TrackControlPoint { position: THREE.Vector3; up: THREE.Vector3; section: TrackFrame['section'] }

export function createTrack(profile?: AltitudeProfile, preset?: DifficultyPreset, authored?: readonly TrackControlPoint[]): Track {
  const altitudeProfile = resolveAltitudeProfile(profile ?? preset?.altitude);
  const minHeight = altitudeProfile.levels[0];
  const maxHeight = altitudeProfile.levels[altitudeProfile.levels.length - 1];
  const points: THREE.Vector3[] = [];
  const hints: THREE.Vector3[] = [];
  const kinds: TrackFrame['section'][] = [];
  const add = (x: number, y: number, z: number, up = new THREE.Vector3(0, 1, 0), kind: TrackFrame['section'] = 'course') => {
    points.push(new THREE.Vector3(x, y, z)); hints.push(up); kinds.push(kind);
  };
  if (authored) {
    for (const point of authored) add(point.position.x, point.position.y, point.position.z, point.up.clone(), point.section);
  } else {
  add(-140, 12, 120); add(-140, 12, 40); add(-140, 12, -40); add(-140, 12, -120);
  // A 136 m tall vertical loop. Its 48 m sideways exit keeps both roads apart.
  for (let i = 0; i <= 96; i++) {
    const u = i / 96, angle = u * Math.PI * 2;
    add(-140 + 48 * u * u * (3 - 2 * u), 12 + 68 * (1 - Math.cos(angle)), -200 - 68 * Math.sin(angle),
      new THREE.Vector3(0, Math.cos(angle), Math.sin(angle)), 'vertical-loop');
  }
  add(-92, 16, -310); add(-40, 62, -390); add(60, 32, -400);
  // Two spring turns advance 260 m per turn, with the road facing the coil's axis.
  const turns = preset?.layout.helixTurns ?? 2;
  const pitch = preset?.layout.helixPitch ?? 260;
  const coilSamples = turns * 64;
  for (let i = 0; i <= coilSamples; i++) {
    const angle = i / coilSamples * Math.PI * 2 * turns;
    add(130 + 44 * Math.sin(angle), 76 - 44 * Math.cos(angle), -460 - pitch * angle / (Math.PI * 2),
      new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0), 'helix');
  }
  const coilEnd = -460 - pitch * turns;
  const gentle = preset?.layout.corners === 'gentle';
  add(200, 32, coilEnd - 70); add(310, gentle ? 32 : 42, coilEnd - 160); add(430, 24, coilEnd - 80);
  if (preset?.layout.corners === 'technical') {
    add(470, 12, coilEnd + 130); add(370, 65, coilEnd + 300);
    add(470, 18, coilEnd + 470); add(370, 65, coilEnd + 630);
  } else { add(gentle ? 470 : 430, 12, coilEnd + 130); add(gentle ? 470 : 430, 18, -450); }
  add(400, gentle ? 32 : 55, -80);
  add(270, 28, 170); add(90, 12, 260); add(-70, 12, 245);
  }
  if (points.length < 4) throw new Error('A closed course needs at least four control points.');
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
  curve.arcLengthDivisions = 16384;
  const length = curve.getLength();
  const divisions = Math.ceil(length * 3);
  const positions: THREE.Vector3[] = [], orientations: THREE.Quaternion[] = [];
  const sampleKinds: TrackFrame['section'][] = [];
  const tangent = new THREE.Vector3(), normal = new THREE.Vector3(), right = new THREE.Vector3(), back = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const sections: { kind: TrackFrame['section']; start: number; end: number }[] = [];
  for (let i = 0; i <= divisions; i++) {
    const u = i / divisions;
    const t = curve.getUtoTmapping(u, 0);
    const index = Math.min(points.length - 1, Math.floor(t * points.length));
    const mix = t * points.length - index;
    const next = (index + 1) % points.length;
    curve.getTangent(t, tangent).normalize();
    normal.copy(hints[index]).lerp(hints[next], mix);
    normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
    right.crossVectors(tangent, normal).normalize();
    normal.crossVectors(right, tangent).normalize();
    basis.makeBasis(right, normal, back.copy(tangent).negate());
    positions.push(curve.getPoint(t));
    orientations.push(new THREE.Quaternion().setFromRotationMatrix(basis));
    const kind = mix < 0.5 ? kinds[index] : kinds[next];
    sampleKinds.push(kind);
    const distance = u * length;
    if (!sections.length || sections[sections.length - 1].kind !== kind) sections.push({ kind, start: distance, end: distance });
    else sections[sections.length - 1].end = distance;
  }
  // The closed seam shares exactly the same orientation, including roll.
  positions[divisions].copy(positions[0]); orientations[divisions].copy(orientations[0]);
  const quaternion = new THREE.Quaternion();
  const previousTangent = new THREE.Vector3(), nextTangent = new THREE.Vector3();
  const at = (distance: number) => {
    const u = ((distance % length) + length) % length / length * divisions;
    return { index: Math.floor(u), mix: u - Math.floor(u) };
  };
  const directionAt = (distance: number, target: THREE.Vector3) => {
    const { index, mix } = at(distance);
    quaternion.copy(orientations[index]).slerp(orientations[index + 1], mix);
    return target.set(0, 0, -1).applyQuaternion(quaternion);
  };
  const heightObstacles: HeightObstacle[] = preset ? preset.obstacleLevels.map((level, i) => {
    const height = altitudeProfile.levels[level];
    if (height === undefined) throw new Error('Obstacle requires an unavailable altitude level.');
    return { distance: 110 + i / preset.obstacleLevels.length * (length - 240), depth: 4,
      visual: 'discharge-arcs', speedRetention: 0.35,
      kind: level === 0 ? 'descend' : level === altitudeProfile.levels.length - 1 ? 'rise' : 'middle',
      minAltitude: level === 0 ? minHeight : height - 0.45,
      maxAltitude: level === altitudeProfile.levels.length - 1 ? maxHeight : height + 0.45 };
  }) : [80, 165, length * 0.32, length * 0.43, length * 0.66, length * 0.8].map((distance, i) => ({
    distance, depth: 4, visual: 'discharge-arcs', speedRetention: 0.35, kind: i % 2 === 0 ? 'rise' : 'descend',
    minAltitude: i % 2 === 0 ? Math.max(minHeight, maxHeight - 1) : minHeight,
    maxAltitude: i % 2 === 0 ? maxHeight : Math.min(maxHeight, minHeight + 0.9),
  }));
  const track: Track = {
    altitudeProfile, sections,
    randomizeObstacles(random) {
      const layout = track.rollObstacleLayout?.(random);
      const corridors = layout?.corridors ?? track.corridorObstacles;
      heightObstacles.splice(0, heightObstacles.length, ...randomObstacleAltitudes(layout?.heights ?? heightObstacles, altitudeProfile.levels, random));
      if (corridors) Object.assign(track, { corridorObstacles: randomCorridorLanes(corridors, track.halfWidth, random) });
      if (layout) Object.assign(track, { boostPads: randomPadLanes(track, layout.pads, track.corridorObstacles ?? [], random), mineFields: layout.mineFields,
        arcRails: layout.arcRails, boostRings: randomRingSides(track, layout.boostRings, track.corridorObstacles ?? [], random) });
    },
    length, halfWidth: preset?.layout.halfWidth ?? 11, checkpointSpacing: length / 24,
    heightObstacles,
    sample(distance, target = createTrackFrame()) {
      target.distanceScale = 1;
      const { index, mix } = at(distance);
      target.position.copy(positions[index]).lerp(positions[index + 1], mix);
      quaternion.copy(orientations[index]).slerp(orientations[index + 1], mix);
      target.right.set(1, 0, 0).applyQuaternion(quaternion);
      target.up.set(0, 1, 0).applyQuaternion(quaternion);
      target.tangent.set(0, 0, -1).applyQuaternion(quaternion);
      target.section = sampleKinds[index];
      directionAt(distance - 0.5, previousTangent); directionAt(distance + 0.5, nextTangent);
      target.curvature = target.section === 'course' ? nextTangent.sub(previousTangent).dot(target.right) : 0;
      return target;
    },
  };
  heightObstacles.splice(0, heightObstacles.length, ...expandObstacleLayout(track, heightObstacles));
  return track;
}

const maxAltitude = (track: Track) => track.altitudeProfile.levels[track.altitudeProfile.levels.length - 1];

export function createTrackVisual(track: Track, lineColor?: string) {
  const group = new THREE.Group();
  group.name = 'neonLoop';
  const paths = roadPaths(track);
  const vertices: number[] = [], indices: number[] = [];
  const left: THREE.Vector3[] = [], right: THREE.Vector3[] = [];
  const frame = createTrackFrame();
  const edgeMaterial = new THREE.MeshBasicMaterial({ color: lineColor ? new THREE.Color(lineColor).multiplyScalar(1.3) : new THREE.Color(0.12, 1.3, 1.1) });
  const dummy = new THREE.Object3D(), basis = new THREE.Matrix4(), back = new THREE.Vector3();
  const orient = (object: THREE.Object3D) => object.quaternion.setFromRotationMatrix(basis.makeBasis(frame.right, frame.up, back.copy(frame.tangent).negate()));
  for (const path of paths) {
    const count = Math.ceil((path.end - path.start) / 1.2);
    const edges: THREE.Vector3[][][] = [[[]], [[]]];
    const first = vertices.length / 3;
    for (let i = 0; i <= count; i++) {
      const distance = path.start + i / count * (path.end - path.start);
      track.sample(distance, frame, path.routeId);
      const boundary = roadBoundary(track, distance, frame, path.routeId);
      vertices.push(...boundary.edges[0].toArray(), ...boundary.edges[1].toArray());
      left.push(boundary.edges[0]); right.push(boundary.edges[1]);
      for (let side = 0; side < 2; side++) {
        const runs = edges[side], run = runs[runs.length - 1];
        if (boundary.visible[side]) run.push(boundary.edges[side].clone().addScaledVector(frame.up, .12));
        else if (run.length) runs.push([]);
      }
      if (i < count) { const n = first + i * 2; indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); }
    }
    const closed = paths.length === 1;
    for (const edge of edges.flat()) {
      if (edge.length < 2) continue;
      if (closed) edge.pop();
      group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, closed, 'centripetal'), edge.length - 1, .12, 5, closed), edgeMaterial));
    }
  }
  const roadGeometry = new THREE.BufferGeometry();
  roadGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  roadGeometry.setIndex(indices); roadGeometry.computeVertexNormals();
  group.add(new THREE.Mesh(roadGeometry, new THREE.MeshStandardMaterial({ color: 0x12242d, roughness: .85, metalness: .2, side: THREE.DoubleSide })));
  const dashMaterial = new THREE.MeshBasicMaterial({ color: lineColor ? new THREE.Color(lineColor).multiplyScalar(.28) : 0x426c76 });
  const marks = (spacing: number, sides: boolean, geometry: THREE.BufferGeometry, material: THREE.Material, height: number, edgeInset: number) => {
    const samples = paths.flatMap(path => {
      const result: { distance: number; routeId: string | null; side: number | null }[] = [];
      const route = track.branches?.flatMap(f => f.routes).find(r => r.id === path.routeId);
      for (let d = path.start; d < path.end; d += spacing) {
        track.sample(d, frame, path.routeId);
        if (sides) {
          const boundary = roadBoundary(track, d, frame, path.routeId);
          for (let side = 0; side < 2; side++) if (boundary.visible[side]) result.push({ distance: d, routeId: path.routeId, side });
        } else {
          // Two centerlines across the joined pavement look like crossing roads.
          if (route && (d <= route.mouthEnd || d >= route.mergeStart)) continue;
          result.push({ distance: d, routeId: path.routeId, side: null });
        }
      }
      return result;
    });
    const mesh = new THREE.InstancedMesh(geometry, material, samples.length);
    samples.forEach((sample, i) => {
      track.sample(sample.distance, frame, sample.routeId);
      dummy.position.copy(frame.position).addScaledVector(frame.up, height);
      if (sample.side !== null) dummy.position.addScaledVector(frame.right, (sample.side ? 1 : -1) * (track.halfWidth - edgeInset));
      orient(dummy); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    });
    group.add(mesh);
  };
  marks(9, false, new THREE.BoxGeometry(.16, .035, 3.8), dashMaterial, .035, 0);
  marks(4, true, new THREE.BoxGeometry(.3, .03, 1.8), dashMaterial, .045, 2);
  marks(18, true, new THREE.BoxGeometry(.4, 3, 1), new THREE.MeshBasicMaterial({ color: 0x285e67 }), 1.5, 0);
  // Near structures frame the technical lane; the other branch keeps open sky.
  const ribMaterial = new THREE.MeshStandardMaterial({ color: 0x12202c, metalness: .5, roughness: .6 });
  for (const fork of track.branches ?? []) {
    for (const u of [.27, .47, .67]) {
      track.sample(fork.start + (fork.end - fork.start) * u, frame, fork.routes[0].id);
      const rib = new THREE.Group();
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(2, 16, 3), ribMaterial);
        post.position.set(side * (track.halfWidth + 10), 8, 0); rib.add(post);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(.25, 14, .3), edgeMaterial);
        strip.position.set(side * (track.halfWidth + 8.8), 8, 1.6); rib.add(strip);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(track.halfWidth * 2 + 22, 2, 3), ribMaterial);
      roof.position.y = 17; rib.add(roof);
      rib.position.copy(frame.position); orient(rib); group.add(rib);
    }
    track.sample(fork.start - 95, frame);
    const sign = new THREE.Group(); sign.name = `junction-sign-${fork.id}`;
    const arrows = fork.kind === 'horizontal' ? ['←', '→'] : ['↓', '↑'];
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 144;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#07131ef0'; context.fillRect(0, 0, 1024, 144);
        context.strokeStyle = lineColor ?? '#67dcd0'; context.lineWidth = 5; context.strokeRect(3, 3, 1018, 138);
        context.fillStyle = '#eaffff'; context.font = 'bold 34px sans-serif'; context.textAlign = 'center';
        fork.routes.forEach((r, i) => { context.fillText(`${arrows[i]} ${r.name}`, 256 + i * 512, 60);
          context.font = '24px sans-serif'; context.fillStyle = '#91aebd'; context.fillText(fork.kind === 'horizontal' ? (i ? '오른쪽 길 →' : '← 왼쪽 길') : i ? `↑ 위쪽 길: ${verticalThreshold(track) + 1}단 이상` : '↓ 아래쪽 길', 256 + i * 512, 108);
          context.font = 'bold 34px sans-serif'; context.fillStyle = '#eaffff'; });
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(36, 5), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, toneMapped: false }));
        panel.position.y = maxAltitude(track) + 8; sign.add(panel);
      }
    }
    sign.position.copy(frame.position); orient(sign); group.add(sign);
  }
  const makeBarriers = () => track.heightObstacles.map(obstacle => {
    track.sample(obstacle.distance, frame, obstacle.routeId);
    const barrier = createDischargeBarrier(obstacle, track.halfWidth, maxAltitude(track));
    barrier.object.position.copy(frame.position);
    orient(barrier.object);
    group.add(barrier.object);
    return barrier;
  });
  let barriers = makeBarriers();
  const makeCorridors = () => (track.corridorObstacles ?? []).map(obstacle => {
    const visual = createCorridorVisual(track, obstacle); group.add(visual.object); return visual;
  });
  let corridors = makeCorridors();
  const makePads = () => { const visual = createBoostPadVisual(track); group.add(visual.object); return visual; };
  let pads = makePads();
  const makeMines = () => { const visual = createMineFieldVisual(track); group.add(visual.object); return visual; };
  let mines = makeMines();
  const makeRails = () => { const visual = createArcRailVisual(track); group.add(visual.object); return visual; };
  let rails = makeRails();
  const makeRings = () => { const visual = createBoostRingVisual(track); group.add(visual.object); return visual; };
  let rings = makeRings();
  const refreshObstacles = () => {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    for (const barrier of [...barriers, ...corridors]) {
      barrier.object.removeFromParent();
      barrier.object.traverse(child => {
        if (child instanceof THREE.Mesh) {
          geometries.add(child.geometry);
          (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => materials.add(m));
        }
      });
    }
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    pads.dispose(); mines.dispose(); rails.dispose(); rings.dispose();
    barriers = makeBarriers(); corridors = makeCorridors(); pads = makePads(); mines = makeMines(); rails = makeRails(); rings = makeRings();
  };
  const bounds = new THREE.Box3().setFromPoints(left.concat(right));
  const extent = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const groundSize = Math.max(1800, extent.x + 600, extent.z + 600);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), new THREE.MeshStandardMaterial({ color: 0x080f17, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(center.x, -0.1, center.z); group.add(ground);
  const grid = new THREE.GridHelper(groundSize, Math.ceil(groundSize / 16), 0x19323f, 0x101f2b); grid.position.set(center.x, 0, center.z); group.add(grid);
  return {
    object: group,
    refreshObstacles,
    hit(distance: number, routeId?: string | null) {
      const next = upcomingHeightObstacle(track, distance, routeId);
      if (next && Math.abs(next.distance) <= next.obstacle.depth / 2 + 3.2) {
        barriers[track.heightObstacles.indexOf(next.obstacle)].hit();
      }
      const corridor = upcomingCorridor(track, distance, routeId);
      if (corridor && Math.abs(corridor.distance) <= corridor.obstacle.depth / 2 + 3.2)
        corridors[(track.corridorObstacles ?? []).indexOf(corridor.obstacle)].hit();
      mines.hit(distance, routeId); rails.hit(distance, routeId);
    },
    /** Flashes the pad nearest to `distance`, as a craft that just triggered it. */
    hitPad(distance: number, routeId?: string | null) { pads.hit(distance, routeId); },
    /** Flashes the boost ring nearest to `distance`. */
    hitRing(distance: number, routeId?: string | null) { rings.hit(distance, routeId); },
    update(time: number, reducedMotion: boolean, distance = 0, altitude = 1.8, speed = 0, offset = 0, routeId?: string | null) {
      pads.update(time, reducedMotion); mines.update(time, reducedMotion); rails.update(time, reducedMotion); rings.update(time, reducedMotion);
      const lap = Math.floor(distance / track.length);
      barriers.forEach((barrier, index) => {
        const obstacle = track.heightObstacles[index];
        let ahead = obstacle.distance + lap * track.length - distance;
        if (ahead < -obstacle.depth / 2 - 2.2) ahead += track.length;
        const nearby = ahead < Math.max(120, speed * 3.5) && (!obstacle.routeId || obstacle.routeId === routeId);
        const actual = resolveHeightObstacle(obstacle, track.altitudeProfile.levels, track.obstacleTime ?? time);
        if (obstacle.motion) {
          const later = resolveHeightObstacle(obstacle, track.altitudeProfile.levels, (track.obstacleTime ?? time) + obstacle.motion.stepSeconds);
          barrier.object.userData.movingDirection = Math.sign(later.minAltitude + later.maxAltitude - actual.minAltitude - actual.maxAltitude);
        }
        const forecast = resolveHeightObstacle(obstacle, track.altitudeProfile.levels, obstacleArrivalTime(track, time, ahead, speed, obstacle.depth, distance, routeId));
        barrier.update(time, reducedMotion, nearby ? altitudeCanPass(altitude, forecast) ? 'ready' : 'blocked' : 'neutral', actual);
      });
      corridors.forEach((visual, index) => {
        const obstacle = track.corridorObstacles![index];
        let ahead = obstacle.distance + lap * track.length - distance;
        if (ahead < -obstacle.depth / 2 - 2.2) ahead += track.length;
        visual.update(time, reducedMotion, ahead < Math.max(180, speed * 3.5) && (!obstacle.routeId || obstacle.routeId === routeId)
          ? corridorCanPass(offset, obstacle) ? 'ready' : 'blocked' : 'neutral');
      });
    },
  };
}
