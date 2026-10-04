// Adapted from the five supplied aircraft. Keep cockpit panels independently dimmable.
// createRacingDrone — five player racing craft for a browser drone-racing game.
// TypeScript source. Runtime copy used by index.html: createRacingDrone.js (same code, types stripped).
// Axes: Y up, -Z forward. Length ≈ 3.7–3.9 units, centred near the origin.
import * as THREE from 'three';

type Pt = [number, number, number];
type Section = Pt[];
export interface DroneVariant { id: string; name: string; neon: number; accent: number; body: number; frame: number; glass: number; desc: string; }
export interface DroneOptions {
  variant?: string;
  bodyColor?: THREE.ColorRepresentation | null; frameColor?: THREE.ColorRepresentation | null; glassColor?: THREE.ColorRepresentation | null;
  neonColor?: THREE.ColorRepresentation | null; accentColor?: THREE.ColorRepresentation | null;
  neonBoost?: number; thrusterIntensity?: number;
}
export interface DroneMaterials {
  bodyMat: THREE.MeshStandardMaterial; frameMat: THREE.MeshStandardMaterial; glassMat: THREE.MeshPhysicalMaterial;
  neonMat: THREE.MeshBasicMaterial; accentMat: THREE.MeshBasicMaterial; thrustMat: THREE.MeshBasicMaterial;
}
interface DroneParts { body: THREE.BufferGeometry[]; frame: THREE.BufferGeometry[]; canopy: THREE.BufferGeometry; panel: THREE.BufferGeometry; neon: THREE.BufferGeometry[]; rings: THREE.BufferGeometry[]; cores: THREE.BufferGeometry[]; anchors: Record<string, Pt>; }

export const DRONE_VARIANTS: DroneVariant[] = [
  { id: 'vanguard', name: 'Vanguard', neon: 0x27eaff, accent: 0xff7b1c, body: 0x141d30, frame: 0x343c4c, glass: 0x1a3d4e,
    desc: '쌍발 나셀 + 버블 캐노피. 균형형 기준 기체.' },
  { id: 'needle', name: 'Needle', neon: 0xb6ff3a, accent: 0xff3fa4, body: 0x10161c, frame: 0x2c3438, glass: 0x1c3a1a,
    desc: '델타 날개 + 낮은 슬릿 바이저. 최고속 직선형.' },
  { id: 'hammerhead', name: 'Hammerhead', neon: 0xffb020, accent: 0x5ac8ff, body: 0x1a1512, frame: 0x3d342c, glass: 0x3a2a12,
    desc: '전방 크로스바 센서 + 랩어라운드 캐노피. 중량 돌파형.' },
  { id: 'catamaran', name: 'Catamaran', neon: 0xb04dff, accent: 0x3dffb0, body: 0x141226, frame: 0x332f4a, glass: 0x2a1a4a,
    desc: '쌍동선 선체 + 오픈 콕핏/롤바. 경량 선회형.' },
  { id: 'halo', name: 'Halo', neon: 0xff3b3b, accent: 0xffd560, body: 0x1b1216, frame: 0x3f2d33, glass: 0x3a1420,
    desc: '단일 환형 엔진 + 각진 쥬얼 캐노피. 고출력 가속형.' },
];

export const DRONE_DEFAULTS: Required<DroneOptions> = {
  variant: 'vanguard',
  bodyColor: null, frameColor: null, glassColor: null, neonColor: null, accentColor: null, // null → variant palette
  neonBoost: 1.6,          // >1 pushes neon above 1.0 so a threshold bloom catches it
  thrusterIntensity: 1.0,
};

// ---------- geometry helpers ----------
function loft(sections: Section[]): THREE.BufferGeometry {
  const n = sections[0].length;
  const pos: number[] = [];
  const tri = (a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
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
// hexagonal hull section with a hard chine at the equator
function hexSection(z: number, w: number, hTop: number, hBot: number, yc: number): Section {
  const k = 0.5;
  return [[w, yc, z], [w * k, yc + hTop, z], [-w * k, yc + hTop, z], [-w, yc, z], [-w * k, yc - hBot, z], [w * k, yc - hBot, z]];
}
// canopy sections: bubble / low visor / faceted jewel (same point count → same loft)
function bubbleSection(z: number, w: number, h: number, yb: number): Section {
  return [[w, yb, z], [0.55 * w, yb + 0.82 * h, z], [0, yb + h, z], [-0.55 * w, yb + 0.82 * h, z], [-w, yb, z], [0, yb - 0.03, z]];
}
function visorSection(z: number, w: number, h: number, yb: number): Section {
  return [[w, yb, z], [0.8 * w, yb + h, z], [0, yb + h * 1.05, z], [-0.8 * w, yb + h, z], [-w, yb, z], [0, yb - 0.03, z]];
}
function jewelSection(z: number, w: number, h: number, yb: number): Section {
  return [[w, yb, z], [0.45 * w, yb + 0.7 * h, z], [0, yb + h, z], [-0.45 * w, yb + 0.7 * h, z], [-w, yb, z], [0, yb - 0.03, z]];
}
function octSection(z: number, r: number, cx: number, cy: number): Section {
  const pts: Section = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    pts.push([cx + r * Math.cos(a), cy + r * 0.9 * Math.sin(a), z]);
  }
  return pts;
}
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
  for (const g of new Set([...geos, ...parts])) g.dispose();
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
function disc(r: number, x: number, y: number, z: number, sy: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, 24);
  g.scale(1, sy, 1); g.translate(x, y, z);
  return g;
}
function mirror(points: Section): Section { return points.map((p): Pt => [-p[0], p[1], p[2]]); }
function box(w: number, h: number, d: number, x: number, y: number, z: number, rx: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}
// flat plate from (x,z) outline, thickness t, centred at height y
function plate(pts: [number, number][], t: number, y: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.rotateX(Math.PI / 2); g.translate(0, y + t / 2, 0);
  return g;
}
// vertical fin from (z,y) outline, thickness t, at x
function fin(pts: [number, number][], t: number, x: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2); g.rotateY(-Math.PI / 2); g.translate(x, 0, 0);
  return g;
}
// standard seat + backrest + dash housing (frame) and instrument panel (neon)
function cockpitFurniture(y: number, zSeat: number) {
  return {
    frame: [box(0.32, 0.07, 0.48, 0, y, zSeat, 0), box(0.32, 0.34, 0.07, 0, y + 0.16, zSeat + 0.28, 0.35), box(0.34, 0.14, 0.05, 0, y + 0.05, zSeat - 0.72, -0.55)],
    neon: [box(0.28, 0.10, 0.012, 0, y + 0.08, zSeat - 0.705, -0.55)],
  };
}
function rails(sections: Section[], r: number): THREE.BufferGeometry[] {
  const rail: Section = sections.map((s): Pt => [s[0][0] + 0.012, s[0][1] + 0.012, s[0][2]]);
  return [tube(rail, r, 24), tube(mirror(rail), r, 24)];
}

// ---------- variants ----------
// Each builder returns { body[], frame[], canopy, neon[], rings[], cores[], anchors }

function buildVanguard(): DroneParts {
  const NX = 1.15, NY = 0.26;
  const hull = loft([
    hexSection(-2.1, 0.04, 0.03, 0.03, 0.06), hexSection(-1.5, 0.18, 0.10, 0.10, 0.08), hexSection(-0.8, 0.33, 0.18, 0.16, 0.12),
    hexSection(0.0, 0.40, 0.24, 0.20, 0.14), hexSection(0.8, 0.37, 0.26, 0.18, 0.16), hexSection(1.5, 0.27, 0.22, 0.14, 0.18), hexSection(1.75, 0.14, 0.12, 0.08, 0.20),
  ]);
  const nacelle = (sx: number) => loft([
    octSection(-0.35, 0.10, sx * NX, NY), octSection(-0.05, 0.24, sx * NX, NY), octSection(0.40, 0.32, sx * NX, NY),
    octSection(1.10, 0.32, sx * NX, NY), octSection(1.50, 0.27, sx * NX, NY), octSection(1.62, 0.21, sx * NX, NY),
  ]);
  const pylon = (sx: number) => plate([[sx * 0.30, -0.05], [sx * 0.95, 0.30], [sx * 0.95, 1.00], [sx * 0.30, 0.85]], 0.07, 0.255);
  const canopyS = [bubbleSection(-1.00, 0.12, 0.03, 0.25), bubbleSection(-0.65, 0.25, 0.22, 0.30), bubbleSection(-0.20, 0.31, 0.50, 0.35),
    bubbleSection(0.30, 0.30, 0.50, 0.39), bubbleSection(0.80, 0.20, 0.14, 0.43), bubbleSection(0.95, 0.10, 0.02, 0.44)];
  const identity: Section = [[0.05, 0.09, -2.08], [0.20, 0.13, -1.45], [0.35, 0.17, -0.75], [0.415, 0.19, -0.05], [0.62, 0.33, 0.13], [0.90, 0.33, 0.30], [1.15, 0.56, 0.70], [1.15, 0.56, 1.15], [1.15, 0.50, 1.63]];
  const f = cockpitFurniture(0.42, 0.10);
  return {
    body: [hull, nacelle(1), nacelle(-1), fin([[0.95, 0.40], [1.80, 0.40], [1.82, 0.74], [1.30, 0.84]], 0.05, 0)],
    frame: [pylon(1), pylon(-1), ...f.frame],
    canopy: loft(canopyS),
    neon: [tube(identity, 0.022, 48), tube(mirror(identity), 0.022, 48), ...rails(canopyS, 0.014),
      ring(0.335, 0.014, NX, NY, 0.45, 0.9), ring(0.335, 0.014, -NX, NY, 0.45, 0.9), line([0, 0.85, 1.30], [0, 0.75, 1.82], 0.014)],
    rings: [ring(0.235, 0.026, NX, NY, 1.64, 0.9), ring(0.235, 0.026, -NX, NY, 1.64, 0.9)],
    cores: [disc(0.2, NX, NY, 1.635, 0.9), disc(0.2, -NX, NY, 1.635, 0.9)],
    panel: f.neon[0],
    anchors: { cockpitCameraMount: [0, 0.70, 0.15], chaseCameraTarget: [0, 0.30, 0], thrusterLeft: [-NX, NY, 1.70], thrusterRight: [NX, NY, 1.70] },
  };
}

function buildNeedle(): DroneParts {
  const yc = 0.10, WX = 1.3;
  const hull = loft([
    hexSection(-2.0, 0.03, 0.02, 0.02, yc), hexSection(-1.3, 0.13, 0.08, 0.07, yc), hexSection(-0.5, 0.26, 0.16, 0.13, yc + 0.03),
    hexSection(0.3, 0.30, 0.22, 0.14, yc + 0.05), hexSection(1.1, 0.27, 0.18, 0.12, yc + 0.06), hexSection(1.7, 0.22, 0.14, 0.10, yc + 0.06), hexSection(1.95, 0.20, 0.12, 0.09, yc + 0.06),
  ]);
  const wing = (sx: number) => plate([[sx * 0.25, 0.10], [sx * WX, 1.55], [sx * WX, 1.92], [sx * 0.25, 1.95]], 0.06, yc);
  const canard = (sx: number) => plate([[sx * 0.12, -1.35], [sx * 0.50, -1.15], [sx * 0.50, -1.05], [sx * 0.12, -0.95]], 0.04, yc + 0.02);
  const pod = (sx: number) => loft([octSection(1.25, 0.03, sx * WX, yc), octSection(1.45, 0.11, sx * WX, yc), octSection(1.85, 0.11, sx * WX, yc), octSection(1.97, 0.08, sx * WX, yc)]);
  // dorsal intake hump behind the visor + wing-root fences
  const hump = loft([hexSection(0.9, 0.10, 0.06, 0.0, 0.33), hexSection(1.2, 0.16, 0.14, 0.0, 0.30), hexSection(1.7, 0.14, 0.12, 0.0, 0.29), hexSection(1.95, 0.08, 0.06, 0.0, 0.28)]);
  const fence = (sx: number) => fin([[0.55, yc + 0.03], [1.5, yc + 0.03], [1.5, yc + 0.16], [0.75, yc + 0.14]], 0.03, sx * 0.62);
  const canopyS = [visorSection(-0.85, 0.08, 0.02, 0.22), visorSection(-0.45, 0.22, 0.10, 0.27), visorSection(-0.05, 0.27, 0.20, 0.32),
    visorSection(0.40, 0.26, 0.19, 0.35), visorSection(0.85, 0.17, 0.08, 0.33), visorSection(1.0, 0.08, 0.02, 0.32)];
  const chine: Section = [[0.04, yc, -1.98], [0.14, yc, -1.3], [0.27, yc + 0.03, -0.5], [0.31, yc + 0.05, 0.3], [0.28, yc + 0.06, 1.1], [0.23, yc + 0.06, 1.7], [0.21, yc + 0.06, 1.94]];
  const lead: Section = [[0.27, yc + 0.045, 0.10], [WX + 0.005, yc + 0.045, 1.55]];
  const fenceEdge = (sx: number) => line([sx * 0.62, yc + 0.165, 0.76], [sx * 0.62, yc + 0.175, 1.5], 0.012);
  const wingTip = (sx: number) => line([sx * (WX + 0.005), yc + 0.045, 1.55], [sx * (WX + 0.005), yc + 0.045, 1.92], 0.016);
  const canardEdge = (sx: number) => line([sx * 0.13, yc + 0.05, -1.34], [sx * 0.50, yc + 0.05, -1.15], 0.012);
  const humpRing = ring(0.09, 0.012, 0, 0.38, 1.05, 0.9);
  const f = cockpitFurniture(0.28, 0.15);
  return {
    body: [hull, wing(1), wing(-1), canard(1), canard(-1), pod(1), pod(-1), hump, fence(1), fence(-1), fin([[1.2, 0.28], [1.95, 0.28], [1.95, 0.66], [1.5, 0.76]], 0.05, 0)],
    frame: f.frame,
    canopy: loft(canopyS),
    neon: [tube(chine, 0.02, 40), tube(mirror(chine), 0.02, 40), line(lead[0], lead[1], 0.02), line([-lead[0][0], lead[0][1], lead[0][2]], [-lead[1][0], lead[1][1], lead[1][2]], 0.02),
      fenceEdge(1), fenceEdge(-1), wingTip(1), wingTip(-1), canardEdge(1), canardEdge(-1), humpRing,
      ...rails(canopyS, 0.012), line([0, 0.77, 1.5], [0, 0.67, 1.95], 0.014)],
    rings: [ring(0.19, 0.024, 0, yc + 0.06, 1.97, 0.9), ring(0.085, 0.016, WX, yc, 1.98, 0.9), ring(0.085, 0.016, -WX, yc, 1.98, 0.9), disc(0.075, 0, 0.38, 1.04, 0.9)],
    cores: [disc(0.16, 0, yc + 0.06, 1.965, 0.9), disc(0.07, WX, yc, 1.975, 0.9), disc(0.07, -WX, yc, 1.975, 0.9)],
    panel: f.neon[0],
    anchors: { cockpitCameraMount: [0, 0.48, 0.15], chaseCameraTarget: [0, 0.2, 0], thrusterLeft: [-WX, yc, 2.05], thrusterRight: [WX, yc, 2.05] },
  };
}

function buildHammerhead(): DroneParts {
  const yc = 0.14, PX = 1.15, NX = 0.56, NY = yc + 0.08;
  const hull = loft([
    hexSection(-1.7, 0.06, 0.04, 0.04, yc), hexSection(-1.2, 0.30, 0.16, 0.14, yc), hexSection(-0.4, 0.38, 0.24, 0.18, yc),
    hexSection(0.4, 0.40, 0.28, 0.18, yc + 0.02), hexSection(1.2, 0.34, 0.24, 0.14, yc + 0.04), hexSection(1.9, 0.18, 0.12, 0.08, yc + 0.06),
  ]);
  const bar = loft([hexSection(-1.25, 0.05, 0.03, 0.03, 0), hexSection(-1.05, 0.20, 0.09, 0.08, 0), hexSection(-0.4, 0.28, 0.11, 0.10, 0),
    hexSection(0.4, 0.28, 0.11, 0.10, 0), hexSection(1.05, 0.20, 0.09, 0.08, 0), hexSection(1.25, 0.05, 0.03, 0.03, 0)]);
  bar.rotateY(Math.PI / 2); bar.translate(0, yc, -1.15);
  const pod = (sx: number) => loft([octSection(-1.65, 0.03, sx * PX, yc), octSection(-1.5, 0.13, sx * PX, yc), octSection(-0.85, 0.13, sx * PX, yc), octSection(-0.7, 0.07, sx * PX, yc)]);
  const nacelle = (sx: number) => loft([octSection(0.25, 0.08, sx * NX, NY), octSection(0.6, 0.24, sx * NX, NY), octSection(1.3, 0.28, sx * NX, NY), octSection(1.8, 0.24, sx * NX, NY), octSection(1.96, 0.18, sx * NX, NY)]);
  const canopyS = [visorSection(-0.75, 0.10, 0.03, 0.33), visorSection(-0.4, 0.30, 0.22, 0.36), visorSection(0.0, 0.36, 0.38, 0.40),
    visorSection(0.45, 0.33, 0.36, 0.43), visorSection(0.8, 0.20, 0.12, 0.44), visorSection(0.95, 0.09, 0.02, 0.44)];
  const chine: Section = [[0.06, yc, -1.68], [0.30, yc, -1.2], [0.38, yc, -0.4], [0.40, yc + 0.02, 0.4], [0.34, yc + 0.04, 1.2], [0.18, yc + 0.06, 1.9]];
  const spine: Section = canopyS.map((s): Pt => [0, s[2][1] + 0.012, s[2][2]]); // kept for reference; a centre rib blocks the cockpit view
  void spine;
  const f = cockpitFurniture(0.44, 0.22);
  return {
    body: [hull, bar, pod(1), pod(-1), nacelle(1), nacelle(-1)],
    frame: [...f.frame],
    canopy: loft(canopyS),
    neon: [line([-1.22, yc, -1.44], [1.22, yc, -1.44], 0.022), tube(chine, 0.02, 40), tube(mirror(chine), 0.02, 40),
      ring(0.125, 0.014, PX, yc, -1.52, 0.9), ring(0.125, 0.014, -PX, yc, -1.52, 0.9), ...rails(canopyS, 0.013)],
    rings: [ring(0.2, 0.026, NX, NY, 1.98, 0.9), ring(0.2, 0.026, -NX, NY, 1.98, 0.9)],
    cores: [disc(0.17, NX, NY, 1.975, 0.9), disc(0.17, -NX, NY, 1.975, 0.9)],
    panel: f.neon[0],
    anchors: { cockpitCameraMount: [0, 0.70, 0.3], chaseCameraTarget: [0, 0.3, 0], thrusterLeft: [-NX, NY, 2.05], thrusterRight: [NX, NY, 2.05] },
  };
}

function buildCatamaran(): DroneParts {
  const HX = 0.9, HY = 0.18, yc = 0.22;
  const hullSide = (sx: number) => loft([octSection(-1.9, 0.04, sx * HX, HY), octSection(-1.4, 0.16, sx * HX, HY), octSection(-0.6, 0.27, sx * HX, HY),
    octSection(0.4, 0.30, sx * HX, HY), octSection(1.2, 0.28, sx * HX, HY), octSection(1.7, 0.22, sx * HX, HY), octSection(1.8, 0.18, sx * HX, HY)]);
  const pod = loft([hexSection(-1.1, 0.05, 0.03, 0.03, yc), hexSection(-0.7, 0.20, 0.12, 0.10, yc), hexSection(-0.2, 0.30, 0.16, 0.12, yc),
    hexSection(0.4, 0.30, 0.16, 0.12, yc), hexSection(0.9, 0.20, 0.12, 0.10, yc), hexSection(1.15, 0.08, 0.05, 0.05, yc)]);
  // open cockpit: short windscreen only, plus a rollbar hoop behind the seat
  const canopyS = [bubbleSection(-0.75, 0.08, 0.02, 0.32), bubbleSection(-0.55, 0.24, 0.14, 0.34), bubbleSection(-0.35, 0.29, 0.24, 0.36), bubbleSection(-0.2, 0.29, 0.26, 0.37)];
  const hoop = new THREE.TorusGeometry(0.33, 0.035, 6, 20, Math.PI); hoop.translate(0, 0.40, 0.45);
  const spine = (sx: number): Section => [[sx * HX, HY + 0.15, -1.4], [sx * HX, HY + 0.255, -0.6], [sx * HX, HY + 0.28, 0.4], [sx * HX, HY + 0.26, 1.2], [sx * HX, HY + 0.21, 1.7]];
  const f = cockpitFurniture(0.38, 0.15);
  return {
    body: [hullSide(1), hullSide(-1), pod, box(1.85, 0.09, 0.40, 0, 0.30, 0.78, 0), box(1.85, 0.06, 0.18, 0, 0.18, -0.95, 0)],
    frame: [...f.frame, hoop, box(0.06, 0.06, 0.6, 0.33, 0.42, 0.15, 0), box(0.06, 0.06, 0.6, -0.33, 0.42, 0.15, 0)],
    canopy: loft(canopyS),
    neon: [tube(spine(1), 0.02, 36), tube(spine(-1), 0.02, 36), line([-0.92, 0.355, 0.58], [0.92, 0.355, 0.58], 0.016),
      line([-0.92, 0.215, -1.04], [0.92, 0.215, -1.04], 0.014), ...rails(canopyS, 0.013),
      ring(0.33, 0.012, 0, 0.40, 0.49, 1).rotateX(0) ],
    rings: [ring(0.17, 0.024, HX, HY, 1.82, 0.9), ring(0.17, 0.024, -HX, HY, 1.82, 0.9)],
    cores: [disc(0.14, HX, HY, 1.815, 0.9), disc(0.14, -HX, HY, 1.815, 0.9)],
    panel: f.neon[0],
    anchors: { cockpitCameraMount: [0, 0.66, 0.2], chaseCameraTarget: [0, 0.3, 0], thrusterLeft: [-HX, HY, 1.9], thrusterRight: [HX, HY, 1.9] },
  };
}

function buildHalo(): DroneParts {
  const yc = 0.16, RZ = 1.6, RY = 0.25, R = 0.85;
  const hull = loft([
    hexSection(-2.0, 0.04, 0.03, 0.03, yc), hexSection(-1.4, 0.18, 0.10, 0.10, yc), hexSection(-0.6, 0.34, 0.20, 0.18, yc),
    hexSection(0.1, 0.38, 0.26, 0.20, yc), hexSection(0.6, 0.32, 0.20, 0.16, yc), hexSection(0.95, 0.20, 0.12, 0.10, yc),
  ]);
  const halo = new THREE.TorusGeometry(R, 0.11, 8, 48); halo.translate(0, RY, RZ);
  const strut = (sx: number, sy: number) => line([sx * 0.25, RY + sy * 0.12, 0.75], [sx * 0.62, RY + sy * 0.62, RZ], 0.045);
  // mid-body: twin intake scoops riding the chine, nose blade, keel
  const scoop = (sx: number) => loft([octSection(-1.0, 0.03, sx * 0.46, yc + 0.04), octSection(-0.7, 0.13, sx * 0.50, yc + 0.04), octSection(0.1, 0.15, sx * 0.54, yc + 0.04), octSection(0.6, 0.13, sx * 0.52, yc + 0.04), octSection(0.75, 0.06, sx * 0.50, yc + 0.04)]);
  const blade = (sx: number) => plate([[sx * 0.05, -1.95], [sx * 0.62, -1.25], [sx * 0.62, -1.10], [sx * 0.15, -1.05]], 0.04, yc + 0.01);
  const canopyS = [jewelSection(-0.95, 0.10, 0.03, 0.30), jewelSection(-0.55, 0.26, 0.24, 0.34), jewelSection(-0.15, 0.32, 0.52, 0.39),
    jewelSection(0.30, 0.28, 0.46, 0.40), jewelSection(0.65, 0.15, 0.12, 0.36), jewelSection(0.8, 0.07, 0.02, 0.33)];
  const identity: Section = [[0.05, yc, -1.98], [0.19, yc, -1.4], [0.35, yc, -0.6], [0.39, yc, 0.1], [0.33, yc, 0.6], [0.28, RY + 0.1, 0.78], [0.64, RY + 0.66, RZ - 0.08]];
  const bladeEdge = (sx: number) => line([sx * 0.06, yc + 0.035, -1.94], [sx * 0.62, yc + 0.035, -1.25], 0.016);
  const scoopRing = (sx: number) => ring(0.135, 0.012, sx * 0.50, yc + 0.04, -0.72, 0.9);
  const scoopSlit = (sx: number) => line([sx * 0.50, yc + 0.19, -0.5], [sx * 0.54, yc + 0.20, 0.5], 0.012);
  const chevron: Section = [[-0.2, yc + 0.27, 0.35], [0, yc + 0.28, 0.15], [0.2, yc + 0.27, 0.35]];
  const haloEdge = new THREE.TorusGeometry(R + 0.09, 0.018, 6, 48); haloEdge.translate(0, RY, RZ - 0.06);
  const inner = new THREE.TorusGeometry(0.72, 0.03, 6, 48); inner.translate(0, RY, RZ + 0.03);
  const core = new THREE.RingGeometry(0.58, 0.70, 48); core.translate(0, RY, RZ);
  const f = cockpitFurniture(0.36, 0.05);
  return {
    body: [hull, halo, strut(1, 1), strut(-1, 1), strut(1, -1), strut(-1, -1), scoop(1), scoop(-1), blade(1), blade(-1), fin([[0.2, -0.02], [0.95, -0.02], [0.95, -0.32], [0.5, -0.3]], 0.05, 0)],
    frame: f.frame,
    canopy: loft(canopyS),
    neon: [tube(identity, 0.022, 48), tube(mirror(identity), 0.022, 48), ...rails(canopyS, 0.013), haloEdge, bladeEdge(1), bladeEdge(-1), scoopRing(1), scoopRing(-1), scoopSlit(1), scoopSlit(-1)],
    rings: [inner, disc(0.09, 0.50, yc + 0.04, -0.73, 0.9), disc(0.09, -0.50, yc + 0.04, -0.73, 0.9)],
    cores: [core],
    panel: f.neon[0],
    anchors: { cockpitCameraMount: [0, 0.68, 0.05], chaseCameraTarget: [0, 0.3, 0], thrusterLeft: [-0.64, RY, RZ + 0.15], thrusterRight: [0.64, RY, RZ + 0.15] },
  };
}

const BUILDERS: Record<string, () => DroneParts> = { vanguard: buildVanguard, needle: buildNeedle, hammerhead: buildHammerhead, catamaran: buildCatamaran, halo: buildHalo };

// ---------- assembly ----------
export function createRacingDrone(options: DroneOptions = {}): THREE.Group {
  const o: Required<DroneOptions> = { ...DRONE_DEFAULTS, ...options };
  const v = DRONE_VARIANTS.find((d) => d.id === o.variant) || DRONE_VARIANTS[0];
  const col = (opt: THREE.ColorRepresentation | null, fallback: number): THREE.ColorRepresentation => (opt == null ? fallback : opt);
  const drone = new THREE.Group();
  drone.name = 'racingDrone_' + v.id;

  const bodyMat = new THREE.MeshStandardMaterial({ name: 'body', color: col(o.bodyColor, v.body), roughness: 0.5, metalness: 0.25, flatShading: true });
  const frameMat = new THREE.MeshStandardMaterial({ name: 'frame', color: col(o.frameColor, v.frame), roughness: 0.6, metalness: 0.3, flatShading: true });
  const glassMat = new THREE.MeshPhysicalMaterial({ name: 'glass', color: col(o.glassColor, v.glass), roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.55,
    emissive: new THREE.Color(col(o.neonColor, v.neon)).multiplyScalar(0.12), side: THREE.FrontSide });
  const neonMat = new THREE.MeshBasicMaterial({ name: 'neon', color: new THREE.Color(col(o.neonColor, v.neon)).multiplyScalar(o.neonBoost), toneMapped: false });
  const accentBase = new THREE.Color(col(o.accentColor, v.accent)).multiplyScalar(o.neonBoost);
  const accentMat = new THREE.MeshBasicMaterial({ name: 'neonAccent', color: accentBase.clone(), toneMapped: false });
  const thrustMat = new THREE.MeshBasicMaterial({ name: 'thrusterCore', color: accentBase.clone(), toneMapped: false, side: THREE.DoubleSide });

  const parts = BUILDERS[v.id]();
  const add = (name: string, geos: THREE.BufferGeometry[], mat: THREE.Material, shadow = true) => {
    const m = new THREE.Mesh(geos.length === 1 ? geos[0] : merge(geos), mat);
    m.name = name; m.castShadow = shadow; drone.add(m); return m;
  };
  add('body', parts.body, bodyMat);
  add('frame', parts.frame, frameMat);
  const canopy = new THREE.Mesh(parts.canopy, glassMat); canopy.name = 'canopy'; drone.add(canopy);
  add('neon', parts.neon, neonMat, false);
  add('instrumentPanel', [parts.panel], neonMat.clone(), false);
  add('thrusterRings', parts.rings, accentMat, false);
  add('thrusterCores', parts.cores, thrustMat, false);

  for (const [name, p] of Object.entries(parts.anchors)) {
    const a = new THREE.Object3D(); a.name = name; a.position.set(p[0], p[1], p[2]); drone.add(a);
  }

  drone.userData.variant = v.id;
  drone.userData.accentBase = accentBase;
  drone.userData.materials = { bodyMat, frameMat, glassMat, neonMat, accentMat, thrustMat } satisfies DroneMaterials;
  drone.userData.setThrusterIntensity = (x: number) => setThrusterIntensity(drone, x);
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
