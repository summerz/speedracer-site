// createRacingDrone — player racing drone for a browser drone-racing game.
// Adapted from incoming-resources/racing-drone/src/createRacingDrone.ts.
// Integration changes: explicit Section type on the identity-line coordinates.
// Axes: Y up, -Z forward. Length ≈ 3.9 units, centred near the origin.
import * as THREE from 'three';

type Pt = [number, number, number];
type Section = Pt[];

export interface DroneOptions {
  bodyColor?: THREE.ColorRepresentation;
  frameColor?: THREE.ColorRepresentation;
  glassColor?: THREE.ColorRepresentation;
  neonColor?: THREE.ColorRepresentation;
  accentColor?: THREE.ColorRepresentation;
  neonBoost?: number;
  thrusterIntensity?: number;
}

export interface DroneMaterials {
  bodyMat: THREE.MeshStandardMaterial;
  frameMat: THREE.MeshStandardMaterial;
  glassMat: THREE.MeshPhysicalMaterial;
  neonMat: THREE.MeshBasicMaterial;
  accentMat: THREE.MeshBasicMaterial;
  thrustMat: THREE.MeshBasicMaterial;
}

export const DRONE_DEFAULTS: Required<DroneOptions> = {
  bodyColor: 0x141d30,     // deep blue-black hull
  frameColor: 0x343c4c,    // graphite frame / pylons / seat
  glassColor: 0x1a3d4e,
  neonColor: 0x27eaff,     // primary: teal
  accentColor: 0xff7b1c,   // secondary: thruster orange (try 0xb04dff for violet)
  neonBoost: 1.6,          // >1 pushes neon above 1.0 so a threshold bloom catches it
  thrusterIntensity: 1.0,
};

// ---------- geometry helpers ----------

// Loft: connect successive cross-sections (same point count, CCW seen from +Z)
// into a closed faceted solid. Non-indexed → flat normals.
function loft(sections: Section[]): THREE.BufferGeometry {
  const n = sections[0].length;
  const pos: number[] = [];
  const tri = (a: Pt | number[], b: Pt | number[], c: Pt | number[]) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let s = 0; s < sections.length - 1; s++) {
    const A = sections[s], B = sections[s + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tri(A[i], B[j], B[i]);
      tri(A[i], A[j], B[j]);
    }
  }
  const cap = (P: Section, flip: boolean) => {
    const c = [0, 0, 0];
    for (const p of P) { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n; }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (flip) tri(c, P[j], P[i]); else tri(c, P[i], P[j]);
    }
  };
  cap(sections[0], true);
  cap(sections[sections.length - 1], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Hexagonal hull section with a hard chine at the equator.
function hexSection(z: number, w: number, hTop: number, hBot: number, yc: number): Section {
  const k = 0.5;
  return [[w, yc, z], [w * k, yc + hTop, z], [-w * k, yc + hTop, z], [-w, yc, z], [-w * k, yc - hBot, z], [w * k, yc - hBot, z]];
}
function canopySection(z: number, w: number, h: number, yb: number): Section {
  return [[w, yb, z], [0.55 * w, yb + 0.82 * h, z], [0, yb + h, z], [-0.55 * w, yb + 0.82 * h, z], [-w, yb, z], [0, yb - 0.03, z]];
}
function octSection(z: number, r: number, cx: number, cy: number): Section {
  const pts: Section = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    pts.push([cx + r * Math.cos(a), cy + r * 0.9 * Math.sin(a), z]);
  }
  return pts;
}

// Merge non-indexed geometries sharing one material into a single draw call.
function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of parts) count += g.attributes.position.count;
  const p = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    if (!g.attributes.normal) g.computeVertexNormals();
    p.set(g.attributes.position.array as ArrayLike<number>, o * 3);
    nrm.set(g.attributes.normal.array as ArrayLike<number>, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  for (const g of parts) g.dispose();
  return out;
}

function tube(points: Section, r: number, segs: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  return new THREE.TubeGeometry(curve, segs, r, 5, false);
}
function line(a: Pt, b: Pt, r: number): THREE.BufferGeometry {
  const curve = new THREE.LineCurve3(new THREE.Vector3(a[0], a[1], a[2]), new THREE.Vector3(b[0], b[1], b[2]));
  return new THREE.TubeGeometry(curve, 1, r, 5, false);
}
function ring(r: number, t: number, x: number, y: number, z: number, sy: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, t, 6, 36);
  g.scale(1, sy, 1);
  g.translate(x, y, z);
  return g;
}
function mirror(points: Section): Section {
  return points.map((p): Pt => [-p[0], p[1], p[2]]);
}
function box(w: number, h: number, d: number, x: number, y: number, z: number, rx: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

// ---------- the drone ----------

export function createRacingDrone(options: DroneOptions = {}): THREE.Group {
  const o: Required<DroneOptions> = { ...DRONE_DEFAULTS, ...options };
  const drone = new THREE.Group();
  drone.name = 'racingDrone';

  // Materials (shared, named — names survive OBJ/GLB export)
  const bodyMat = new THREE.MeshStandardMaterial({ name: 'body', color: o.bodyColor, roughness: 0.5, metalness: 0.25, flatShading: true });
  const frameMat = new THREE.MeshStandardMaterial({ name: 'frame', color: o.frameColor, roughness: 0.6, metalness: 0.3, flatShading: true });
  const glassMat = new THREE.MeshPhysicalMaterial({ name: 'glass', color: o.glassColor, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.55, emissive: 0x0a2a36, side: THREE.FrontSide });
  const neonMat = new THREE.MeshBasicMaterial({ name: 'neonTeal', color: new THREE.Color(o.neonColor).multiplyScalar(o.neonBoost), toneMapped: false });
  const accentBase = new THREE.Color(o.accentColor).multiplyScalar(o.neonBoost);
  const accentMat = new THREE.MeshBasicMaterial({ name: 'neonAccent', color: accentBase.clone(), toneMapped: false });
  const thrustMat = new THREE.MeshBasicMaterial({ name: 'thrusterCore', color: accentBase.clone(), toneMapped: false });

  // --- Body: central hull + nacelles + fin (one mesh) ---
  const hullSections = [
    hexSection(-2.1, 0.04, 0.03, 0.03, 0.06),
    hexSection(-1.5, 0.18, 0.10, 0.10, 0.08),
    hexSection(-0.8, 0.33, 0.18, 0.16, 0.12),
    hexSection(0.0, 0.40, 0.24, 0.20, 0.14),
    hexSection(0.8, 0.37, 0.26, 0.18, 0.16),
    hexSection(1.5, 0.27, 0.22, 0.14, 0.18),
    hexSection(1.75, 0.14, 0.12, 0.08, 0.20),
  ];
  const NX = 1.15, NY = 0.26; // nacelle axis
  const nacelle = (sx: 1 | -1) => loft([
    octSection(-0.35, 0.10, sx * NX, NY),
    octSection(-0.05, 0.24, sx * NX, NY),
    octSection(0.40, 0.32, sx * NX, NY),
    octSection(1.10, 0.32, sx * NX, NY),
    octSection(1.50, 0.27, sx * NX, NY),
    octSection(1.62, 0.21, sx * NX, NY),
  ]);
  const finShape = new THREE.Shape(); // (z, y)
  finShape.moveTo(0.95, 0.40); finShape.lineTo(1.80, 0.40); finShape.lineTo(1.82, 0.74); finShape.lineTo(1.30, 0.84); finShape.closePath();
  const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.05, bevelEnabled: false });
  fin.translate(0, 0, -0.025); fin.rotateY(-Math.PI / 2);

  const body = new THREE.Mesh(merge([loft(hullSections), nacelle(1), nacelle(-1), fin]), bodyMat);
  body.name = 'body';
  drone.add(body);

  // --- Frame: swept pylons + cockpit furniture (one mesh) ---
  const pylon = (sx: 1 | -1) => {
    const s = new THREE.Shape(); // (x, z)
    s.moveTo(sx * 0.30, -0.05); s.lineTo(sx * 0.95, 0.30); s.lineTo(sx * 0.95, 1.00); s.lineTo(sx * 0.30, 0.85); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: false });
    g.rotateX(Math.PI / 2); g.translate(0, 0.29, 0);
    return g;
  };
  const frame = new THREE.Mesh(merge([
    pylon(1), pylon(-1),
    box(0.34, 0.07, 0.50, 0, 0.42, 0.10, 0),          // seat pan
    box(0.34, 0.36, 0.07, 0, 0.58, 0.38, 0.35),       // backrest (reclined)
    box(0.36, 0.14, 0.05, 0, 0.47, -0.62, -0.55),     // dash housing
  ]), frameMat);
  frame.name = 'frame';
  drone.add(frame);

  // --- Cockpit canopy ---
  const canopySections = [
    canopySection(-1.00, 0.12, 0.03, 0.25),
    canopySection(-0.65, 0.25, 0.22, 0.30),
    canopySection(-0.20, 0.31, 0.50, 0.35),
    canopySection(0.30, 0.30, 0.50, 0.39),
    canopySection(0.80, 0.20, 0.14, 0.43),
    canopySection(0.95, 0.10, 0.02, 0.44),
  ];
  const canopy = new THREE.Mesh(loft(canopySections), glassMat);
  canopy.name = 'canopy';
  canopy.castShadow = false;
  drone.add(canopy);

  // --- Neon (teal): identity line nose→hull chine→pylon edge→nacelle spine, canopy rails, collars, fin edge, dash ---
  const identity: Section = [
    [0.05, 0.09, -2.08], [0.20, 0.13, -1.45], [0.35, 0.17, -0.75], [0.415, 0.19, -0.05],
    [0.62, 0.33, 0.13], [0.90, 0.33, 0.30], [1.15, 0.56, 0.70], [1.15, 0.56, 1.15], [1.15, 0.50, 1.63],
  ];
  const rail: Section = canopySections.map((s): Pt => [s[0][0] + 0.012, s[0][1] + 0.012, s[0][2]]);
  const neon = new THREE.Mesh(merge([
    tube(identity, 0.022, 48), tube(mirror(identity), 0.022, 48),
    tube(rail, 0.014, 24), tube(mirror(rail), 0.014, 24),
    ring(0.335, 0.014, NX, NY, 0.45, 0.9), ring(0.335, 0.014, -NX, NY, 0.45, 0.9),
    line([0, 0.85, 1.30], [0, 0.75, 1.82], 0.014),
  ]), neonMat);
  neon.name = 'neonTeal';
  neon.castShadow = false;
  drone.add(neon);
  const instrumentPanel = new THREE.Mesh(box(0.30, 0.10, 0.012, 0, 0.50, -0.605, -0.55), neonMat.clone());
  instrumentPanel.name = 'instrumentPanel';
  drone.add(instrumentPanel);

  // --- Propulsion glow (accent): rear rings + thruster cores ---
  const rings = new THREE.Mesh(merge([ring(0.235, 0.026, NX, NY, 1.64, 0.9), ring(0.235, 0.026, -NX, NY, 1.64, 0.9)]), accentMat);
  rings.name = 'thrusterRings';
  rings.castShadow = false;
  drone.add(rings);
  const coreL = new THREE.CircleGeometry(0.2, 24); coreL.scale(1, 0.9, 1); coreL.translate(-NX, NY, 1.635);
  const coreR = new THREE.CircleGeometry(0.2, 24); coreR.scale(1, 0.9, 1); coreR.translate(NX, NY, 1.635);
  const cores = new THREE.Mesh(merge([coreL, coreR]), thrustMat);
  cores.name = 'thrusterCores';
  cores.castShadow = false;
  drone.add(cores);

  // --- Named anchors ---
  const anchor = (name: string, x: number, y: number, z: number) => { const a = new THREE.Object3D(); a.name = name; a.position.set(x, y, z); drone.add(a); return a; };
  anchor('cockpitCameraMount', 0, 0.70, 0.15);
  anchor('chaseCameraTarget', 0, 0.30, 0.0);
  anchor('thrusterLeft', -NX, NY, 1.70);
  anchor('thrusterRight', NX, NY, 1.70);

  drone.userData.accentBase = accentBase;
  drone.userData.materials = { bodyMat, frameMat, glassMat, neonMat, accentMat, thrustMat } satisfies DroneMaterials;
  drone.userData.setThrusterIntensity = (v: number) => setThrusterIntensity(drone, v);
  setThrusterIntensity(drone, o.thrusterIntensity);
  return drone;
}

// 0 = cold/off, 1 = default, >1 = boost. Scales core + ring glow.
export function setThrusterIntensity(drone: THREE.Group, v: number): void {
  const m = drone.userData.materials as DroneMaterials | undefined;
  const base = drone.userData.accentBase as THREE.Color | undefined;
  if (!m || !base) return;
  const k = Math.max(0, v);
  m.thrustMat.color.copy(base).multiplyScalar(0.08 + k);
  m.accentMat.color.copy(base).multiplyScalar(0.15 + 0.85 * Math.min(k, 1.5));
  drone.userData.thrusterIntensity = v;
}
