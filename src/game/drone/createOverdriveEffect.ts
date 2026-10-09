import * as THREE from 'three';
import type { DroneMaterials } from './createRacingDrone';

/** Reversible visual layer. Flight controls and the craft's original geometry remain independent. */
export function createOverdriveEffect(drone: THREE.Group, color: THREE.ColorRepresentation) {
  const root = new THREE.Group();
  root.name = 'overdrive';
  drone.add(root);
  const tint = new THREE.Color(color);
  const awakenedNeon = new THREE.Color('#eafff3').multiplyScalar(1.7);
  const light = new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(1.7), toneMapped: false });
  const white = new THREE.MeshBasicMaterial({ color: new THREE.Color('#eafff3').multiplyScalar(1.6), toneMapped: false });
  const armor = new THREE.MeshStandardMaterial({ color: '#36434d', metalness: .7, roughness: .3, side: THREE.DoubleSide });
  const energy = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: .025,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const resources = new Set<THREE.BufferGeometry>();
  const animations: ((strength: number, time: number) => void)[] = [];
  const original = drone.userData.materials as DroneMaterials;
  const neon = original.neonMat.color.clone(), emissive = original.bodyMat.emissive.clone();
  const emissiveIntensity = original.bodyMat.emissiveIntensity;
  let strength = 1, time = 0, disposed = false;
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = root) => {
    resources.add(geometry);
    const object = new THREE.Mesh(geometry, material);
    parent.add(object);
    return object;
  };
  const tube = (points: THREE.Vector3[], radius: number, material: THREE.Material,
    parent: THREE.Object3D = root, smooth = true) => {
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < points.length; i++) path.add(new THREE.LineCurve3(points[i - 1], points[i]));
    return mesh(new THREE.TubeGeometry(smooth ? new THREE.CatmullRomCurve3(points) : path,
      48, radius, 6, false), material, parent);
  };
  const panel = (side: number, x: number, z: number, width: number, length: number, sweep: number) => {
    const hinge = new THREE.Group();
    hinge.position.set(side * x, .28, z);
    root.add(hinge);
    const points = [[0, -length * .5], [side * width, sweep], [side * width * .85, length * .65], [0, length * .5]];
    const shape = new THREE.Shape(points.map(([px, pz]) => new THREE.Vector2(px, pz)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: .065, bevelEnabled: false });
    geometry.rotateX(Math.PI / 2);
    mesh(geometry, armor, hinge);
    tube([...points, points[0]].map(([px, pz]) => new THREE.Vector3(px, .015, pz)), .025, light, hinge, false);
    tube([new THREE.Vector3(0, .04, -length * .28), new THREE.Vector3(side * width * .72, .04, sweep + .2),
      new THREE.Vector3(side * width * .65, .04, length * .48)], .012, white, hinge, false);
    animations.push(s => { hinge.rotation.z = side * (.95 - s * .72); hinge.scale.setScalar(.3 + s * .7); });
    return hinge;
  };
  const halo = (radius: number, y: number, z: number, tilt = 0) => {
    const ring = mesh(new THREE.TorusGeometry(radius, .025, 8, 80), light);
    ring.position.set(0, y, z); ring.rotation.y = tilt;
    animations.push((s, t) => { ring.scale.setScalar(.7 + s * .3 + Math.sin(t * 2) * .012 * s); });
  };
  switch (drone.userData.variant) {
    case 'needle':
      for (const side of [-1, 1]) panel(side, .9, .55, .9, 2.4, .75);
      break;
    case 'hammerhead':
      for (const side of [-1, 1]) {
        panel(side, .92, -1.1, .72, 1.1, -.35);
        panel(side, .66, 1.25, .45, .9, .25);
      }
      break;
    case 'catamaran':
      for (const side of [-1, 1]) {
        panel(side, 1.08, .0, .48, 2.7, .45);
        tube([new THREE.Vector3(side * .9, .55, -1.3), new THREE.Vector3(side * .9, .7, 0),
          new THREE.Vector3(side * .9, .6, 1.8)], .025, white);
      }
      break;
    case 'halo':
      halo(1.08, .25, 1.6);
      halo(1.25, .25, 1.85, .08);
      for (const side of [-1, 1]) panel(side, .52, .1, .5, 1.1, .2);
      break;
    default:
      for (const side of [-1, 1]) {
        // Nacelles extend to ±1.47. Deploy beyond them so the outline changes without bloom.
        const wing = panel(side, 1.55, .25, .85, 2.1, .48);
        wing.position.y = .46;
        animations.push(s => { wing.position.x = side * (1.05 + .5 * s); });
        tube([new THREE.Vector3(side * 1.14, .36, .5), new THREE.Vector3(side * 1.55, .46, .25)], .055, armor);
        const fin = panel(side, 1.32, 1.45, .55, .85, .25);
        fin.position.y = .7;
      }
  }
  // Bounds stay in craft space, even when the effect is attached to a moving craft.
  const body = drone.getObjectByName('body') as THREE.Mesh;
  body.updateMatrix();
  body.geometry.computeBoundingBox();
  const bounds = body.geometry.boundingBox!.clone().applyMatrix4(body.matrix);
  const size = bounds.getSize(new THREE.Vector3());
  for (const side of [-1, 1]) {
    const anchor = drone.getObjectByName(side < 0 ? 'thrusterLeft' : 'thrusterRight')!;
    const plume = new THREE.Group();
    plume.position.copy(anchor.position);
    root.add(plume);
    for (const [radius, material] of [[.20, energy], [.055, white]] as const) {
      const geometry = new THREE.ConeGeometry(radius, 2.5, 16, 1, true);
      geometry.rotateX(Math.PI / 2); geometry.translate(0, 0, 1.25);
      mesh(geometry, material, plume);
    }
    animations.push((s, t) => { plume.scale.set(1, 1, (.3 + s * .7) * (1 + Math.sin(t * 15) * .025)); });
  }
  // Thin, body-local arcs leave the road and warning UI clear.
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? -1 : 1, z = -.95 + Math.floor(i / 2) * .95;
    const arc = tube([new THREE.Vector3(side * size.x * .4, .25, z - .2),
      new THREE.Vector3(side * size.x * .53, .55, z), new THREE.Vector3(side * size.x * .38, .76, z + .16),
      new THREE.Vector3(side * size.x * .47, .38, z + .38)], .009, white);
    animations.push((s, t) => { arc.visible = s > .5 && Math.sin(t * 9 + i * 1.7) > -.15; });
  }
  const update = (delta: number, reducedMotion = false) => {
    if (disposed) return;
    time = reducedMotion ? 0 : time + Math.max(0, Math.min(delta, .1));
    root.visible = strength > .001;
    original.neonMat.color.copy(neon).lerp(awakenedNeon, strength * .65);
    original.bodyMat.emissive.copy(emissive).lerp(tint, strength * .15);
    original.bodyMat.emissiveIntensity = emissiveIntensity + strength * .25;
    energy.opacity = strength * .18;
    animations.forEach(animate => animate(strength, time));
  };
  update(0);
  return {
    setStrength(value: number) { strength = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0; },
    update,
    dispose() {
      if (disposed) return;
      disposed = true; root.removeFromParent();
      resources.forEach(geometry => geometry.dispose());
      [light, white, armor, energy].forEach(material => material.dispose());
      original.neonMat.color.copy(neon); original.bodyMat.emissive.copy(emissive);
      original.bodyMat.emissiveIntensity = emissiveIntensity;
    },
  };
}
