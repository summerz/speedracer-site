import * as THREE from 'three';
import type { MarinePalette } from '../environment/marineZones.js';

/** Per-vertex flags: kind 0 solid, 1 emissive, 2 eye. `sway` is a horizontal amplitude in metres. */
export interface PartOptions { kind?: number; sway?: number; phase?: number; sec?: boolean; swayFn?: (v: THREE.Vector3, uv: THREE.Vector2) => number }

export const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const UP = new THREE.Vector3(0, 1, 0);
export const mat = (p: [number, number, number], r: [number, number, number] = [0, 0, 0], s: [number, number, number] | number = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s));
/** Appends indexed geometries into one set of attribute arrays. */
export class GiantBuilder {
  private pos: number[] = []; private nor: number[] = []; private col: number[] = []; private meta: number[] = []; private loc: number[] = []; private idx: number[] = [];
  private base = new THREE.Matrix4();
  /** Everything added inside `fn` is first transformed by `m` (used to tilt a whole ship). */
  within(m: THREE.Matrix4, fn: () => void) { const prev = this.base.clone(); this.base.premultiply(m); fn(); this.base.copy(prev); }
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation, o: PartOptions = {}) {
    const mm = this.base.clone().multiply(m), nm = new THREE.Matrix3().getNormalMatrix(mm), c = new THREE.Color(color);
    const p = g.attributes.position, n = g.attributes.normal, uvA = g.attributes.uv, v = new THREE.Vector3(), nv = new THREE.Vector3(), uv = new THREE.Vector2();
    const first = this.pos.length / 3, phase = o.phase ?? 0;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); nv.fromBufferAttribute(n, i);
      if (uvA) uv.set(uvA.getX(i), uvA.getY(i));
      const sway = o.swayFn ? o.swayFn(v, uv) : o.sway ?? 0;
      if (o.kind === 2) this.loc.push(v.x, v.y, v.z); else this.loc.push(0, 0, 0);
      v.applyMatrix4(mm); nv.applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z); this.nor.push(nv.x, nv.y, nv.z); this.col.push(c.r, c.g, c.b);
      this.meta.push(o.kind ?? 0, sway, phase, o.sec ? 1 : 0);
    }
    const ix = g.index; if (ix) for (let i = 0; i < ix.count; i++) this.idx.push(ix.getX(i) + first); else for (let i = 0; i < p.count; i++) this.idx.push(first + i);
    g.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 3)); g.setAttribute('aMeta', new THREE.Float32BufferAttribute(this.meta, 4));
    g.setAttribute('aLocal', new THREE.Float32BufferAttribute(this.loc, 3)); g.setIndex(this.idx);
    g.computeBoundingSphere(); return g;
  }
}

const sphere = (w = 12, h = 8) => new THREE.SphereGeometry(1, w, h);
const box = () => new THREE.BoxGeometry(1, 1, 1);
const cyl = (rt: number, rb: number, seg = 10, h = 1) => new THREE.CylinderGeometry(rt, rb, h, seg, 1);

/** Tube along a curve that tapers from r0 to r1. */
function taperedTube(curve: THREE.Curve<THREE.Vector3>, tubular: number, radial: number, r0: number, r1: number, ease = .85) {
  const g = new THREE.TubeGeometry(curve, tubular, 1, radial, false), p = g.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular, r = r0 + (r1 - r0) * Math.pow(u, ease); curve.getPointAt(u, c);
    for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c); p.setXYZ(k, v.x, v.y, v.z); }
  }
  return g;
}
const curveOf = (pts: THREE.Vector3[]) => new THREE.CatmullRomCurve3(pts, false, 'centripetal');

/** A flat sheet hanging down from y=0, optionally torn (cells dropped). */
function hangingSheet(w: number, h: number, sx: number, sy: number, rand: () => number, tear = 0, bulge = 0) {
  const g = new THREE.PlaneGeometry(w, h, sx, sy); g.translate(0, -h / 2, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  if (bulge) for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(uv.getX(i) * Math.PI) * Math.sin(uv.getY(i) * 2 + .6) * bulge);
  if (tear > 0) {
    const ix = g.index!, keep: number[] = [];
    for (let cell = 0; cell < sx * sy; cell++) {
      const cx = cell % sx, cy = Math.floor(cell / sx), fromBottom = cy / (sy - 1), edge = Math.abs(cx / (sx - 1) - .5) * 2;
      if (rand() < tear * Math.max(0, fromBottom - .45) * 1.6 * (.5 + edge)) continue;
      for (let k = 0; k < 6; k++) keep.push(ix.getX(cell * 6 + k));
    }
    g.setIndex(keep);
  }
  return g;
}
/** Sway grows toward the free (bottom) end of a hanging sheet. */
const hangSway = (amp: number) => (_: THREE.Vector3, uv: THREE.Vector2) => (1 - uv.y) * (1 - uv.y) * amp;

const shade = (c: THREE.ColorRepresentation, k: number) => new THREE.Color(c).multiplyScalar(k);
const mix = (a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);

// --------------------------------------------------------------------------------------------
// Hull loft shared by the galleon and the liner
// --------------------------------------------------------------------------------------------
interface HullSpec { length: number; beam: number; deck: number; depth: number; sheer: number; bowFrac: number }
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** s: 0 stern -> 1 bow. a: 0 port rail -> PI starboard rail. Returns [x, y, z]. */
function hullPoint(h: HullSpec, s: number, a: number, out = new THREE.Vector3()) {
  const taper = s < h.bowFrac ? .78 + .22 * smooth(0, .25, s) : Math.pow(Math.max(0, 1 - Math.pow((s - h.bowFrac) / (1 - h.bowFrac), 1.7)), .55);
  const w = h.beam * taper, sheer = h.sheer * (Math.pow(1 - s, 2.2) * .5 + Math.pow(s, 3.2));
  const deckY = h.deck + sheer, keel = h.depth * (.55 + .45 * Math.min(1, taper * 1.1)) * (1 - .25 * s * s);
  return out.set(-w * Math.cos(a), deckY - keel * Math.pow(Math.max(0, Math.sin(a)), .7), -h.length / 2 + s * h.length);
}
function hullLoft(h: HullSpec, ns: number, na: number, a0 = 0, a1 = Math.PI, grow = 0, skip?: (i: number, j: number) => boolean) {
  const pos: number[] = [], idx: number[] = [], v = new THREE.Vector3();
  for (let i = 0; i <= ns; i++) for (let j = 0; j <= na; j++) {
    hullPoint(h, i / ns, a0 + (a1 - a0) * j / na, v); if (grow) { v.x += Math.sign(v.x || 1) * grow; }
    pos.push(v.x, v.y, v.z);
  }
  for (let i = 0; i < ns; i++) for (let j = 0; j < na; j++) {
    if (skip?.(i, j)) continue;
    const a = i * (na + 1) + j, b = a + 1, c = a + na + 1, d = c + 1; idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
/** A flat deck between the rails (a 2-point loft). */
function deckLoft(h: HullSpec, ns: number, inset = .9) {
  const pos: number[] = [], idx: number[] = [], v = new THREE.Vector3();
  for (let i = 0; i <= ns; i++) for (const a of [0, Math.PI]) { hullPoint(h, i / ns, a, v); pos.push(v.x * inset, v.y - 1.5, v.z); }
  for (let i = 0; i < ns; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const hullAt = (h: HullSpec, s: number, a: number) => hullPoint(h, s, a);

// --------------------------------------------------------------------------------------------
// 1. Trench: a sleeping giant octopus
// --------------------------------------------------------------------------------------------
export function buildOctopus(b: GiantBuilder, pal: MarinePalette, low: boolean) {
  const r = rng(0x0c70), rock = new THREE.Color(pal.rock), skin = mix(pal.rock, '#5a3a5c', .4).multiplyScalar(1.2), skinDark = shade(skin, .6);
  const ridgeH = (x: number, z: number) => { const t = 1 - (x / 380) ** 2 - ((z + 30) / 210) ** 2; return t > 0 ? -15 + 55 * Math.sqrt(t) : -15; };
  // Far trench ridge.
  b.add(sphere(28, 12), mat([0, -15, -30], [0, 0, 0], [380, 55, 210]), shade(rock, 1.1));
  b.add(sphere(20, 8), mat([-290, -12, 70], [0, .3, 0], [200, 40, 120]), shade(rock, .9));
  b.add(sphere(20, 8), mat([300, -14, 50], [0, -.2, 0], [210, 44, 120]), shade(rock, 1));
  b.add(sphere(20, 8), mat([0, -20, 230], [0, 0, 0], [420, 26, 120]), shade(rock, .8));
  for (let i = 0; i < 9; i++) { const x = (r() - .5) * 700, z = -80 - r() * 140, h = 70 + r() * 110; b.add(cyl(.12, 1, 7, 1), mat([x, h / 2 - 20, z], [(r() - .5) * .2, 0, (r() - .5) * .2], [16 + r() * 26, h, 16 + r() * 22]), shade(rock, .7 + r() * .5)); }
  // Ruined columns and an arch in front of the sleeper.
  const column = (x: number, z: number, h: number, lean: number, rad = 8) => b.add(cyl(rad * .92, rad, 9, 1), mat([x, ridgeH(x, z) + h / 2 - 4, z], [lean, r() * 3, lean * .6], [1, h, 1]), shade(rock, 1.7));
  column(-150, 150, 95, .05); column(-120, 110, 55, .35); column(160, 170, 110, -.06, 9); column(120, 130, 40, -.5);
  column(-40, 210, 70, .1, 7);
  b.add(box(), mat([200, ridgeH(200, 90) + 98, 90], [0, 0, .18], [64, 9, 14]), shade(rock, 1.5));
  column(176, 90, 94, 0, 8); column(226, 90, 100, 0, 8);
  // Mantle, brows, eyes.
  const tilt = -.3, mantleC = new THREE.Vector3(0, 190, -55), MR = new THREE.Vector3(125, 150, 110);
  b.add(sphere(36, 24), mat(mantleC.toArray() as [number, number, number], [tilt, 0, 0], MR.toArray() as [number, number, number]), skin, { sway: 0 });
  b.add(sphere(20, 14), mat([0, 120, 45], [0, 0, 0], [105, 80, 85]), skin);
  for (const sx of [-1, 1]) {
    const eyeDir = new THREE.Vector3(sx * .58, .1, .81).normalize(), eyeP = new THREE.Vector3(sx * 72, 132, 100);
    b.add(sphere(20, 14), mat([sx * 68, 160, 96], [0, 0, sx * .3], [42, 17, 32]), skinDark);
    const right = new THREE.Vector3().crossVectors(UP, eyeDir).normalize(), upE = new THREE.Vector3().crossVectors(eyeDir, right);
    b.add(sphere(24, 18), new THREE.Matrix4().makeBasis(right.multiplyScalar(30), upE.multiplyScalar(30), eyeDir.clone().multiplyScalar(30)).setPosition(eyeP), skin, { kind: 2 });
  }
  // Tentacles draped over the ridge, rocks and ruins.
  const count = low ? 6 : 8;
  for (let i = 0; i < count; i++) {
    const a = -1.35 + 2.7 * i / (count - 1) + (r() - .5) * .15, pts: THREE.Vector3[] = [], wig = r() * 6, len = 300 + r() * 130;
    pts.push(new THREE.Vector3(Math.sin(a) * 60, 90, -20 + Math.cos(a) * 60));
    for (let k = 1; k <= 8; k++) {
      const u = k / 8, rad = 70 + u * len, ang = a + Math.sin(u * 5 + wig) * .22 * u, x = Math.sin(ang) * rad, z = -20 + Math.cos(ang) * rad;
      const ground = Math.max(ridgeH(x, z), -5), thick = 30 * (1 - u) + 3;
      pts.push(new THREE.Vector3(x, k < 3 ? 70 * (1 - u * 3) + ground + thick : ground + thick * .8 + (k === 8 ? 20 : 0) + Math.abs(Math.sin(u * 9 + wig)) * 9, z));
    }
    b.add(taperedTube(curveOf(pts), low ? 36 : 54, 8, 30, 2.4), new THREE.Matrix4(), skin.clone().multiplyScalar(.85 + r() * .3), { sway: 0 });
    if (!low) for (let k = 0; k < 5; k++) { const p = curveOf(pts).getPointAt(.18 + k * .17); b.add(sphere(6, 4), mat([p.x, p.y + 9, p.z], [0, 0, 0], 2.6), new THREE.Color(r() < .5 ? pal.glow : pal.accent), { kind: 1, sec: true, phase: r() }); }
  }
  // Bioluminescent spots along the mantle.
  const spots = low ? 0 : 56;
  for (let i = 0; i < spots; i++) {
    const th = r() * Math.PI * 2, ph = Math.acos(1 - r() * 1.25), d = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    if (d.z > .55 && d.y < .5) continue;
    const p = d.clone().multiply(MR).applyEuler(new THREE.Euler(tilt, 0, 0)).add(mantleC).addScaledVector(d, 2);
    b.add(sphere(6, 4), mat(p.toArray() as [number, number, number], [0, 0, 0], 2 + r() * 3.2), new THREE.Color(r() < .72 ? pal.glow : pal.accent), { kind: 1, sec: true, phase: r() });
  }
}

// --------------------------------------------------------------------------------------------
// 2. Kelp: a wrecked pirate galleon
// --------------------------------------------------------------------------------------------
export function buildGalleon(b: GiantBuilder, pal: MarinePalette, low: boolean) {
  const r = rng(0x6a11e0), wood = new THREE.Color('#5a4228').lerp(new THREE.Color(pal.rock), .25), woodDark = shade(wood, .55), cloth = mix('#7a765e', pal.glow, .08).multiplyScalar(.5);
  const hull: HullSpec = { length: 320, beam: 50, deck: 56, depth: 54, sheer: 26, bowFrac: .6 };
  const kelpCols = [new THREE.Color(pal.kelp[1]).multiplyScalar(1.5), new THREE.Color(pal.kelp[2]).multiplyScalar(.9), new THREE.Color(pal.kelp[0]).multiplyScalar(2.5)];
  b.add(sphere(24, 10), mat([0, -14, -130], [0, 0, 0], [210, 40, 190]), new THREE.Color(pal.sand).multiplyScalar(.9));
  b.add(sphere(20, 8), mat([-230, -16, 60], [0, 0, 0], [170, 32, 140]), new THREE.Color(pal.sand).multiplyScalar(.7));
  for (let i = 0; i < 3; i++) { const x = (r() - .5) * 400, z = -230 - r() * 100; b.add(cyl(.1, 1, 7, 1), mat([x, 40, z], [0, 0, 0], [22 + r() * 24, 100 + r() * 70, 20 + r() * 20]), new THREE.Color(pal.rock).multiplyScalar(.8)); }
  const tilt = mat([10, 55, -30], [-.4, .05, .2], 1.4);
  b.within(tilt, () => {
    const gap = (i: number, j: number) => i >= 8 && i <= 11 && j >= 6 && j <= 10;
    b.add(hullLoft(hull, 28, 10, 0, Math.PI, 0, gap), new THREE.Matrix4(), wood);
    b.add(hullLoft(hull, 28, 10, .14 * Math.PI, .24 * Math.PI, 1.2), new THREE.Matrix4(), shade(wood, 1.6)); // wale stripes
    b.add(hullLoft(hull, 28, 10, .76 * Math.PI, .86 * Math.PI, 1.2), new THREE.Matrix4(), shade(wood, 1.6));
    b.add(deckLoft(hull, 20), new THREE.Matrix4(), woodDark);
    // Exposed ribs where the planking is gone.
    for (let i = 8; i <= 11; i++) {
      const rib: THREE.Vector3[] = []; for (let j = 6; j <= 10; j++) rib.push(hullAt(hull, i / 28, j / 10 * Math.PI));
      if (rib.length > 3) b.add(taperedTube(curveOf(rib), 8, 5, 1.6, 1.6), mat([0, 0, 0]), woodDark);
    }
    // Gun ports and lanterns.
    for (const side of [-1, 1]) for (let row = 0; row < 2; row++) for (let k = 0; k < 9; k++) {
      const s = .14 + k * .065 + row * .02, p = hullAt(hull, s, side < 0 ? .15 * Math.PI + row * .12 : Math.PI - (.15 * Math.PI + row * .12));
      b.add(box(), mat([p.x + side * .6, p.y - 1, p.z], [0, 0, 0], [1.6, 6, 7]), '#050403');
      if (!low && r() < .18) b.add(box(), mat([p.x + side * 1.2, p.y - 1, p.z], [0, 0, 0], [.8, 3.6, 4.6]), new THREE.Color(pal.accent), { kind: 1, sec: true, phase: r() });
    }
    // Stern castle with windows, bowsprit.
    b.add(box(), mat([0, hull.deck + 28, -hullAt(hull, 0, 1).z * .62], [0, 0, 0], [74, 44, 70]), wood);
    b.add(box(), mat([0, hull.deck + 54, -hullAt(hull, 0, 1).z * .55], [0, 0, 0], [80, 5, 76]), woodDark);
    for (let k = -2; k <= 2; k++) b.add(box(), mat([k * 13, hull.deck + 30, -hullAt(hull, 0, 1).z * .62 - 36], [0, 0, 0], [7, 9, 1.5]), new THREE.Color(pal.accent), { kind: 1, sec: true, phase: r() });
    b.add(cyl(1.4, 3.2, 8, 1), mat([0, hull.deck + 28, hull.length / 2 + 26], [Math.PI / 2 - .3, 0, 0], [1, 110, 1]), woodDark);
    // Masts: main intact, fore broken, mizzen snapped.
    const mast = (z: number, h: number, rad: number, lean = 0) => { b.add(cyl(rad * .6, rad, 9, 1), mat([0, hull.deck + h / 2 - 6, z], [0, 0, lean], [1, h, 1]), woodDark); };
    mast(10, 215, 4.2, .04); mast(95, 118, 4, -.03); mast(-85, 78, 3.3, .1);
    b.add(cyl(.2, 1, 5, 1), mat([5, hull.deck + 128, 95], [0, 0, .3], [3.5, 34, 3.5]), woodDark); // splinter
    const yard = (z: number, y: number, len: number, tiltZ = 0) => b.add(cyl(1.3, 1.6, 7, 1), mat([0, hull.deck + y, z], [0, 0, Math.PI / 2 + tiltZ], [1, len, 1]), woodDark);
    yard(10, 200, 100); yard(10, 140, 128, .02); yard(10, 82, 146, -.03); yard(95, 100, 90, .35);
    const sail = (z: number, y: number, w: number, h: number, tear: number, amp: number) =>
      b.add(hangingSheet(w, h, 8, 6, r, tear, 7), mat([0, hull.deck + y, z + 1.5]), cloth.clone().multiplyScalar(.8 + r() * .35), { swayFn: hangSway(amp), phase: r() * 6 });
    sail(10, 198, 92, 52, .5, 7); sail(10, 138, 118, 60, .55, 8); sail(10, 80, 134, 64, .45, 8); sail(95, 98, 78, 40, .7, 6);
    // Rigging.
    const rope = (a: THREE.Vector3, c: THREE.Vector3) => b.add(taperedTube(curveOf([a, a.clone().lerp(c, .5).add(new THREE.Vector3(0, -3, 0)), c]), 6, 4, .6, .6), mat([0, 0, 0]), woodDark);
    for (const sx of [-1, 1]) { rope(new THREE.Vector3(0, hull.deck + 205, 10), new THREE.Vector3(sx * 44, hull.deck + 4, 40)); rope(new THREE.Vector3(0, hull.deck + 205, 10), new THREE.Vector3(sx * 44, hull.deck + 4, -22)); rope(new THREE.Vector3(0, hull.deck + 116, 95), new THREE.Vector3(sx * 40, hull.deck + 4, 120)); }
    rope(new THREE.Vector3(0, hull.deck + 205, 10), new THREE.Vector3(0, hull.deck + 108, 95)); rope(new THREE.Vector3(0, hull.deck + 205, 10), new THREE.Vector3(0, hull.deck + 70, -85));
    b.add(sphere(8, 6), mat([0, hull.deck + 216, 10], [0, 0, 0], 3.2), new THREE.Color(pal.accent), { kind: 1, sec: true, phase: .3 });
    // Strands of kelp hanging from the yards and rails.
    const strandN = low ? 12 : 30;
    for (let i = 0; i < strandN; i++) {
      const h = 40 + r() * 80, onYard = r() < .6, z = onYard ? 10 + (r() < .8 ? 0 : 85) : -100 + r() * 220, y = onYard ? 82 + Math.floor(r() * 3) * 58 : hull.deck + 8, x = onYard ? (r() - .5) * 120 : (r() < .5 ? -1 : 1) * 50;
      b.add(hangingSheet(2.6 + r() * 2.4, h, 1, 7, r), mat([x, onYard ? hull.deck + y - 4 : y, z]), kelpCols[i % 3], { swayFn: hangSway(4 + r() * 6), phase: r() * 6, sec: true });
    }
  });
  // Kelp growing up around the wreck.
  const standing = low ? 14 : 38;
  for (let i = 0; i < standing; i++) {
    const h = 70 + r() * 150, x = (r() - .5) * 460, z = -190 + r() * 340;
    b.add(hangingSheet(3 + r() * 3, h, 1, 8, r), mat([x, h - 5, z], [0, r() * 3, 0]), kelpCols[i % 3], { swayFn: (_v, uv) => hangTop(uv, 7 + r() * 5), phase: r() * 6, sec: true });
  }
}
/** Standing strand sway: free tip is the top (uv.y = 1 at the top of a hanging sheet translated to stand up). */
const hangTop = (uv: THREE.Vector2, amp: number) => Math.pow(uv.y, 1.8) * amp;

// --------------------------------------------------------------------------------------------
// 3. Coral: ancient sea-turtle fossil
// --------------------------------------------------------------------------------------------
export function buildTurtle(b: GiantBuilder, pal: MarinePalette, low: boolean) {
  const r = rng(0x7e47e), bone = mix('#8a7f90', pal.rock, .45), boneHi = shade(bone, 1.35), sand = new THREE.Color(pal.sand).multiplyScalar(.75);
  const C = new THREE.Vector3(0, 0, 0), R = new THREE.Vector3(175, 138, 215);
  const surf = (x: number, z: number) => { const t = 1 - (x / R.x) ** 2 - (z / R.z) ** 2; if (t <= .02) return null; const y = C.y + R.y * Math.sqrt(t), n = new THREE.Vector3(x / R.x ** 2, (y - C.y) / R.y ** 2, z / R.z ** 2).normalize(); return { p: new THREE.Vector3(x, y, z), n }; };
  b.add(sphere(36, 22), mat(C.toArray() as [number, number, number], [0, 0, 0], R.toArray() as [number, number, number]), shade(bone, .55));
  const plate = (x: number, z: number, rx: number, rz: number) => {
    const s = surf(x, z); if (!s) return; const q = new THREE.Quaternion().setFromUnitVectors(UP, s.n);
    b.add(sphere(10, 5), new THREE.Matrix4().compose(s.p.clone().addScaledVector(s.n, -5), q, new THREE.Vector3(rx, 14, rz)), boneHi.clone().multiplyScalar(.8 + r() * .35));
  };
  for (let i = 0; i < 5; i++) plate(0, -150 + i * 78, 50, 38);
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) plate(sx * 88, -115 + i * 80, 40, 38);
  for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, x = Math.sin(a) * R.x * .88, z = Math.cos(a) * R.z * .88; plate(x, z, 26, 26); }
  // Head, beak and neck, half buried.
  b.add(sphere(20, 14), mat([0, 22, 250], [.15, 0, 0], [46, 36, 64]), bone);
  b.add(sphere(14, 10), mat([0, 20, 205], [0, 0, 0], [62, 44, 50]), shade(bone, .8));
  b.add(cyl(.05, 1, 8, 1), mat([0, 14, 322], [Math.PI / 2 + .2, 0, 0], [26, 40, 20]), boneHi);
  for (const sx of [-1, 1]) b.add(sphere(10, 8), mat([sx * 33, 36, 270], [0, 0, 0], 10), '#030304');
  // Flippers.
  for (const sx of [-1, 1]) {
    b.add(sphere(20, 10), mat([sx * 235, 38, 110], [0, sx * -.7, sx * .3], [165, 17, 46]), bone);
    b.add(sphere(14, 8), mat([sx * 350, 70, 170], [0, sx * -.9, sx * .4], [70, 11, 24]), shade(bone, 1.1));
    b.add(sphere(16, 8), mat([sx * 150, 8, -215], [0, sx * .5, 0], [78, 10, 28]), bone);
  }
  // Sand dunes bury the lower body.
  b.add(sphere(30, 8), mat([0, -36, 0], [0, 0, 0], [450, 30, 420]), sand);
  b.add(sphere(20, 8), mat([-280, -20, 250], [0, .4, 0], [200, 30, 130]), sand.clone().multiplyScalar(.8));
  b.add(sphere(20, 8), mat([300, -22, -150], [0, -.4, 0], [220, 34, 150]), sand.clone().multiplyScalar(.9));
  // Coral growths: sprigs with glowing tips, big staghorns, brain domes.
  const coralCol = () => new THREE.Color(r() < .55 ? pal.glow : pal.accent), body = (c: THREE.Color) => c.clone().multiplyScalar(.28);
  const sprig = (p: THREE.Vector3, d: THREE.Vector3, h: number, w: number, c: THREE.Color, tip = true) => {
    const dir = d.clone().add(new THREE.Vector3((r() - .5) * .8, (r() - .2) * .5, (r() - .5) * .8)).normalize(), q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    b.add(cyl(w * .22, w, 5, 1), new THREE.Matrix4().compose(p.clone().addScaledVector(dir, h / 2), q, new THREE.Vector3(1, h, 1)), body(c), { swayFn: () => 0 });
    if (tip) b.add(new THREE.OctahedronGeometry(1, 0), mat(p.clone().addScaledVector(dir, h).toArray() as [number, number, number], [0, 0, 0], w * .9), c, { kind: 1, sec: true, phase: r() });
  };
  const branch = (p: THREE.Vector3, d: THREE.Vector3, h: number, w: number, c: THREE.Color, depth: number) => {
    const end = p.clone().addScaledVector(d, h); b.add(taperedTube(curveOf([p, p.clone().lerp(end, .5).add(new THREE.Vector3((r() - .5) * 4, 0, (r() - .5) * 4)), end]), 3, 4, w, w * .7), mat([0, 0, 0]), body(c));
    if (depth === 0) { b.add(new THREE.OctahedronGeometry(1, 0), mat(end.toArray() as [number, number, number], [0, 0, 0], w * 1.3), c, { kind: 1, sec: true, phase: r() }); return; }
    for (let k = 0; k < 2 + (depth > 1 ? 1 : 0); k++) branch(end, d.clone().add(new THREE.Vector3((r() - .5) * 1.1, r() * .35, (r() - .5) * 1.1)).normalize(), h * .72, w * .72, c, depth - 1);
  };
  const sprigs = low ? 40 : 120;
  for (let i = 0; i < sprigs; i++) { const s = surf((r() * 2 - 1) * R.x * .85, (r() * 2 - 1) * R.z * .85); if (s) sprig(s.p, s.n, 14 + r() * 28, 2.2 + r() * 1.6, coralCol(), !low || i % 2 === 0); }
  for (let i = 0; i < (low ? 6 : 16); i++) { const s = surf((r() * 2 - 1) * R.x * .75, (r() * 2 - 1) * R.z * .75); if (s) branch(s.p.clone().addScaledVector(s.n, -3), s.n.clone().lerp(UP, .6).normalize(), 30 + r() * 26, 5 + r() * 2, coralCol(), 2); }
  for (let i = 0; i < (low ? 3 : 8); i++) { const s = surf((r() * 2 - 1) * R.x * .8, (r() * 2 - 1) * R.z * .8); if (s) b.add(sphere(10, 6), mat(s.p.clone().addScaledVector(s.n, 3).toArray() as [number, number, number], [0, 0, 0], [12 + r() * 12, 8 + r() * 8, 12 + r() * 12]), body(coralCol()).multiplyScalar(1.6)); }
  // Corals on the dunes, head and flippers.
  for (let i = 0; i < (low ? 6 : 22); i++) { const a = r() * 6.28, d = 150 + r() * 260, p = new THREE.Vector3(Math.sin(a) * d * .9, -2, Math.cos(a) * d); branch(p, UP.clone(), 24 + r() * 30, 4.5 + r() * 2, coralCol(), 2); }
}

// --------------------------------------------------------------------------------------------
// 4. Lagoon: a tilted ocean liner and a lighthouse ruin
// --------------------------------------------------------------------------------------------
export interface LagoonParts { lamp: THREE.Vector3 }
export function buildLiner(b: GiantBuilder, pal: MarinePalette, low: boolean): LagoonParts {
  const r = rng(0x11be12), hullCol = mix('#2b3d4a', pal.rock, .3), white = mix('#d8e2dc', pal.rock, .15), band = new THREE.Color(pal.accent).multiplyScalar(.9), glow = new THREE.Color(pal.glow);
  const hull: HullSpec = { length: 440, beam: 36, deck: 44, depth: 44, sheer: 16, bowFrac: .7 };
  const sand = new THREE.Color(pal.sand).multiplyScalar(.7);
  b.add(sphere(28, 8), mat([0, -22, -190], [0, 0, 0], [260, 40, 220]), sand);
  b.add(sphere(20, 8), mat([-250, -22, -60], [0, 0, 0], [180, 30, 150]), sand.clone().multiplyScalar(.8));
  b.add(sphere(20, 8), mat([320, -22, 120], [0, 0, 0], [220, 34, 170]), sand.clone().multiplyScalar(.85));
  const tilt = mat([-110, 100, -120], [-.5, .15, .09], 1.5);
  b.within(tilt, () => {
    b.add(hullLoft(hull, 32, 10), new THREE.Matrix4(), hullCol);
    b.add(hullLoft(hull, 32, 10, .08 * Math.PI, .2 * Math.PI, 1), new THREE.Matrix4(), band);
    b.add(hullLoft(hull, 32, 10, .8 * Math.PI, .92 * Math.PI, 1), new THREE.Matrix4(), band);
    b.add(deckLoft(hull, 24), new THREE.Matrix4(), shade(white, .55));
    // Portholes along both sides.
    for (const side of [-1, 1]) for (let k = 0; k < (low ? 12 : 36); k++) {
      const s = .06 + k * (low ? .08 : .0265), p = hullAt(hull, s, side < 0 ? .27 * Math.PI : Math.PI - .27 * Math.PI);
      b.add(box(), mat([p.x + side * .5, p.y, p.z], [0, 0, 0], [1.2, 2.6, 2.6]), r() < .38 ? glow.clone().multiplyScalar(.9) : '#0a1014', { kind: r() < .38 ? 1 : 0, sec: true, phase: r() });
    }
    // Superstructure decks with window rows.
    const decks: [number, number, number, number][] = [[hull.deck + 7, 300, 56, 14], [hull.deck + 21, 230, 46, 14], [hull.deck + 35, 150, 34, 12]];
    decks.forEach(([y, len, w, h], di) => {
      const z = -30 + di * 8;
      b.add(box(), mat([0, y, z], [0, 0, 0], [w, h, len]), white);
      b.add(box(), mat([0, y + h / 2 + 1.2, z], [0, 0, 0], [w + 5, 2.4, len + 6]), shade(white, .7));
      if (low && di === 1) return;
      for (const side of [-1, 1]) for (let k = 0; k < Math.floor(len / 7); k++) {
        const lit = r() < .42; b.add(box(), mat([side * (w / 2 + .5), y, z - len / 2 + 5 + k * 7], [0, 0, 0], [.8, 4.6, 3.8]), lit ? glow.clone().multiplyScalar(.95) : '#0a1218', { kind: lit ? 1 : 0, sec: true, phase: r() });
      }
    });
    // Bridge, funnels, masts, lifeboats.
    b.add(box(), mat([0, hull.deck + 54, 82], [0, 0, 0], [30, 14, 38]), white);
    for (let i = 0; i < 3; i++) {
      const z = -80 + i * 52, y = hull.deck + 70;
      b.add(cyl(13, 14, 14, 1), mat([0, y, z], [.14, 0, 0], [1, 62, 1.7]), i === 1 ? shade(white, .8) : band);
      b.add(cyl(13.4, 13.4, 14, 1), mat([0, y + 33, z - 4.5], [.14, 0, 0], [1, 8, 1.7]), '#0a0c0e');
    }
    b.add(cyl(.7, 1.2, 6, 1), mat([0, hull.deck + 96, 150], [-.05, 0, 0], [1, 90, 1]), shade(white, .6));
    b.add(cyl(.7, 1.2, 6, 1), mat([0, hull.deck + 76, -150], [.05, 0, 0], [1, 60, 1]), shade(white, .6));
    for (const side of [-1, 1]) for (let k = 0; k < 4; k++) b.add(sphere(8, 6), mat([side * 40, hull.deck + 4, -60 + k * 34], [0, 0, 0], [5, 3.4, 13]), shade(white, 1.1));
    // Hull breach: broken plating with warm light inside.
    b.add(box(), mat([-37, hull.deck - 18, 60], [0, 0, .1], [2, 20, 38]), '#050708');
  });
  // Lighthouse ruin on its own rock.
  const lx = 300, lz = -340;
  b.add(sphere(22, 10), mat([lx, -12, lz], [0, 0, 0], [75, 44, 70]), new THREE.Color(pal.rock).multiplyScalar(1.15));
  b.add(sphere(14, 8), mat([lx - 60, -14, lz - 30], [0, 0, 0], [45, 26, 38]), new THREE.Color(pal.rock));
  const stripe = (y: number, h: number, rb: number, rt: number, c: THREE.Color) => b.add(cyl(rt, rb, 14, 1), mat([lx, y + h / 2, lz], [0, 0, 0], [1, h, 1]), c);
  for (let i = 0; i < 5; i++) stripe(30 + i * 26, 26, 23 - i * 2.3, 23 - (i + 1) * 2.3, i % 2 ? band : white);
  b.add(cyl(21, 14, 14, 1), mat([lx, 164, lz], [0, 0, 0], [1, 4, 1]), shade(white, .6));
  for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28; if (a > 4.2 && a < 5.3) continue; b.add(box(), mat([lx + Math.sin(a) * 20, 169, lz + Math.cos(a) * 20], [0, a, 0], [3, 7, 1.2]), shade(white, .7)); }
  b.add(cyl(10, 10, 12, 1), mat([lx, 178, lz], [0, 0, 0], [1, 15, 1]), glow.clone().multiplyScalar(1.1), { kind: 1, phase: .2 });
  b.add(cyl(.1, 13, 12, 1), mat([lx, 191, lz], [0, 0, 0], [1, 10, 1]), shade(white, .5));
  return { lamp: new THREE.Vector3(lx, 178, lz) };
}
