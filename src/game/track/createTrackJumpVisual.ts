import * as THREE from 'three';
import { createTrackFrame, type Track } from './createTrack.js';

const AMBER = new THREE.Color('#ffb347'), RED = new THREE.Color('#ff5a4a'), MINT = new THREE.Color('#4ff0a6');
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Warning and landing dressing for a broken-road jump: amber approach chevrons with a travelling brightness wave, a striped launch
 * lip with glowing posts, a dashed mint ghost trajectory across the gap, a mint landing lip, and a mint landing zone with edge strips.
 * Solid parts share one instanced mesh; glowing parts are three additive/transparent instanced meshes.
 */
export function createTrackJumpVisual(track: Track) {
  const object = new THREE.Group(); object.name = 'track-jumps';
  const jumps = track.jumps ?? [];
  const frame = createTrackFrame(), basis = new THREE.Matrix4(), back = new THREE.Vector3(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
  const quat = new THREE.Quaternion(), matrix = new THREE.Matrix4(), hw = track.halfWidth, levels = track.altitudeProfile.levels;
  const orient = () => quat.setFromRotationMatrix(basis.makeBasis(frame.right, frame.up, back.copy(frame.tangent).negate()));
  const material = (extra: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ toneMapped: false, ...extra });

  // Solid parts: lips, posts and landing edge strips.
  const solids: { matrix: THREE.Matrix4; color: THREE.Color }[] = [];
  const addSolid = (position: THREE.Vector3, rotation: THREE.Quaternion, size: THREE.Vector3, color: THREE.Color) =>
    solids.push({ matrix: new THREE.Matrix4().compose(position, rotation, size), color });
  // Local-axis offset helper: x across the road, y up, z along (negative = forward).
  const local = (x: number, y: number, z = 0) => pos.copy(frame.position).addScaledVector(frame.right, x).addScaledVector(frame.up, y).addScaledVector(frame.tangent, -z);
  const lip = (distance: number, routeId: string, striped: boolean, color: THREE.Color) => {
    track.sample(distance, frame, routeId); orient();
    const n = striped ? 14 : 1, w = hw * 2 / n;
    for (let i = 0; i < n; i++) addSolid(local(-hw + w * (i + .5), .175).clone(), quat.clone(), scale.set(w, .35, .5).clone(), striped && i % 2 ? RED : color);
    return color;
  };

  // Glowing parts: chevrons (two bars each) and ghost dashes.
  const chevrons = (from: number, to: number, spacing: number, routeId: string, color: THREE.Color) => {
    const matrices: THREE.Matrix4[] = [], width = hw * .55, depth = width * .6, length = Math.hypot(width, depth), angle = Math.atan2(depth, width);
    for (let d = from; d <= to; d += spacing) {
      track.sample(d, frame, routeId); orient();
      for (const side of [-1, 1]) {
        const arm = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -side * angle).premultiply(quat);
        matrices.push(new THREE.Matrix4().compose(local(side * width / 2, .12, 0).clone(), arm, new THREE.Vector3(length, 1, 1)));
      }
    }
    return { matrices, color };
  };
  const glow = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .8 } as const;
  type Waves = { mesh: THREE.InstancedMesh; color: THREE.Color; pairs: number };
  const waves: Waves[] = [];
  const chevronMesh = (all: { matrices: THREE.Matrix4[]; color: THREE.Color }[]) => {
    const total = all.reduce((sum, c) => sum + c.matrices.length, 0);
    if (!total) return;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .06, .45), material(glow), total);
    mesh.frustumCulled = false; let i = 0;
    for (const set of all) for (const m of set.matrices) { mesh.setMatrixAt(i, m); mesh.setColorAt(i, set.color); i++; }
    object.add(mesh); waves.push({ mesh, color: all[0].color, pairs: total / 2 });
  };

  const ghost: THREE.Matrix4[] = [], ghostMaterial = material({ color: MINT, transparent: true, opacity: .6, depthWrite: false });
  const approach: ReturnType<typeof chevrons>[] = [], landing: ReturnType<typeof chevrons>[] = [];
  const up = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3();
  for (const j of jumps) {
    // a) approach chevrons end just before the launch lip; they run forward in time.
    approach.push(chevrons(j.approachStart + 6, j.start - 6, 12, j.routeId, AMBER));
    // b) launch lip with hazard stripes and two glowing posts.
    lip(j.start, j.routeId, true, AMBER);
    track.sample(j.start, frame, j.routeId); orient();
    for (const s of [-1, 1]) addSolid(local(s * (hw - .2), 1.5).clone(), quat.clone(), new THREE.Vector3(.4, 3, .4), AMBER);
    // c) ghost trajectory from launch to landing altitude.
    const from = levels[j.launchLevel], to = levels[j.landingLevel], count = Math.max(2, Math.ceil((j.end - j.start) / 3));
    const points: { p: THREE.Vector3; up: THREE.Vector3 }[] = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count; track.sample(j.start + (j.end - j.start) * t, frame, j.routeId);
      points.push({ p: frame.position.clone().addScaledVector(frame.up, from + (to - from) * smooth(t) + .3), up: frame.up.clone() });
    }
    for (let i = 0; i < count; i++) {
      dir.subVectors(points[i + 1].p, points[i].p).normalize(); up.copy(points[i].up);
      side.crossVectors(dir, up).normalize(); up.crossVectors(side, dir);
      quat.setFromRotationMatrix(basis.makeBasis(side, up, back.copy(dir).negate()));
      ghost.push(new THREE.Matrix4().compose(points[i].p.clone().lerp(points[i + 1].p, .5), quat.clone(), new THREE.Vector3(1, 1, 1)));
    }
    // d) landing lip, e) landing chevrons and edge strips.
    lip(j.end, j.routeId, false, MINT);
    landing.push(chevrons(j.end + 6, j.landingEnd - 2, 8, j.routeId, MINT));
    for (let d = j.end + 2; d < j.landingEnd; d += 4) {
      track.sample(d + 2, frame, j.routeId); orient();
      for (const s of [-1, 1]) addSolid(local(s * (hw - .35), .05).clone(), quat.clone(), new THREE.Vector3(.5, .1, 3.6), MINT);
    }
  }
  const disposables: { dispose(): void }[] = [ghostMaterial];
  if (solids.length) {
    const geometry = new THREE.BoxGeometry(1, 1, 1), mat = material(), mesh = new THREE.InstancedMesh(geometry, mat, solids.length);
    solids.forEach((s, i) => { mesh.setMatrixAt(i, s.matrix); mesh.setColorAt(i, s.color); });
    mesh.frustumCulled = false; object.add(mesh); disposables.push(geometry, mat);
  }
  chevronMesh(approach); chevronMesh(landing);
  if (ghost.length) {
    const geometry = new THREE.BoxGeometry(.35, .35, 1.6), mesh = new THREE.InstancedMesh(geometry, ghostMaterial, ghost.length);
    ghost.forEach((m, i) => mesh.setMatrixAt(i, m)); mesh.frustumCulled = false; object.add(mesh); disposables.push(geometry);
  }
  for (const w of waves) disposables.push(w.mesh.geometry, w.mesh.material as THREE.Material);

  const tint = new THREE.Color();
  return {
    object,
    update(time: number, reducedMotion: boolean) {
      ghostMaterial.opacity = reducedMotion ? .6 : .5 + .2 * Math.sin(time * 4);
      for (const w of waves) {
        const total = w.pairs, spacingSpeed = w.color === AMBER ? 2.5 : 3;
        for (let i = 0; i < total; i++) {
          // Wave front travels toward higher chevron indices (forward along the road).
          const phase = (((time * spacingSpeed - i) % 6) + 6) % 6;
          const b = reducedMotion ? .6 : .25 + .75 * Math.max(0, 1 - phase / 3);
          tint.copy(w.color).multiplyScalar(b);
          w.mesh.setColorAt(i * 2, tint); w.mesh.setColorAt(i * 2 + 1, tint);
        }
        if (w.mesh.instanceColor) w.mesh.instanceColor.needsUpdate = true;
      }
    },
    dispose() { object.removeFromParent(); disposables.forEach(d => d.dispose()); },
  };
}
