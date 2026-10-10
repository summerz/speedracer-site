import * as THREE from 'three';
import type { TrackControlPoint } from './createTrack.js';

export type CourseShape = 'ring' | 'kidney' | 'thumb' | 'eight' | 'clover' | 'triangle' | 'horseshoe' | 'star' | 'knot' | 'crescent' | 'slalom' | 'diamond';
export interface CourseLayout {
  shape: CourseShape;
  radiusX: number;
  radiusZ: number;
  elevation: number;
  waves: number;
  rotation: number;
  bank: number;
  /** +1: upward loop / original winding, -1: downward loop / opposite winding. */
  stunts: readonly { kind: 'loop' | 'helix' | 'roll'; start: number; span: number; radius: number; turns: number; direction?: 1 | -1 }[];
}

/** Closed footprints and local stunts are independent: a loop need not force a long return road. */
export function authorClosedTrack(layout: CourseLayout): TrackControlPoint[] {
  const knots: THREE.Vector3[] = [];
  const marineKnots: Partial<Record<CourseShape, number[][]>> = {
    crescent: [[-.6,-1], [.25,-1.15], [.85,-.65], [1,.1], [.7,.85], [0,1.1], [-.7,.75], [-1,.1], [-.75,-.45], [-.25,-.4], [.05,0], [-.1,.45], [.25,.55], [.55,.15], [.4,-.45]],
    slalom: [[-.6,-1.2], [-.05,-1.25], [.55,-.85], [.25,-.3], [.65,.25], [.25,.8], [.55,1.3], [-.1,1.5], [-.7,1.1], [-.95,.6], [-.65,.05], [-1,-.5]],
    diamond: [[0,-1.25], [.35,-.9], [1,0], [.5,.7], [0,1.25], [-.5,.7], [-1,0], [-.35,-.9]],
  };
  const custom = marineKnots[layout.shape] ?? (layout.shape === 'thumb' ? [[-.8,-.6],[-.7,-1.1],[.05,-1.25],[.55,-.95],[.45,-.25],[.95,.15],[.95,.8],[.45,1],[-.25,.8],[-.85,.25]]
    : layout.shape === 'horseshoe' ? [[-1,-.55],[-1,.5],[-.6,1],[.5,1],[1,.5],[1,-.55],[.9,-.9],[.68,-1],[.52,-.75],[.45,-.45],[.4,.15],[-.35,.15],[-.45,-.45],[-.52,-.75],[-.68,-1],[-.9,-.9]] : undefined);
  const count = custom?.length ?? 96;
  const rotation = new THREE.Matrix4().makeRotationY(layout.rotation);
  for (let i = 0; i < count; i++) {
    const t = i / count, a = t * Math.PI * 2;
    let x: number, z: number;
    if (custom) [x,z] = custom[i];
    else if (layout.shape === 'eight') { x = Math.sin(a); z = Math.sin(2*a); }
    else if (layout.shape === 'knot') { x = (1 + .31*Math.cos(3*a))*Math.cos(2*a); z = (1 + .31*Math.cos(3*a))*Math.sin(2*a); }
    else {
      const r = layout.shape === 'kidney' ? 1 + .3*Math.cos(a) - .12*Math.cos(2*a)
        : layout.shape === 'clover' ? 1 + .27*Math.cos(3*a)
        : layout.shape === 'triangle' ? 1 + .14*Math.cos(3*a)
        : layout.shape === 'star' ? 1 + .14*Math.cos(5*a) : 1;
      x = r*Math.cos(a); z = r*Math.sin(a);
    }
    // At the two figure-eight crossings, cos(a) gives separate upper/lower decks.
    const height = layout.shape === 'eight' ? layout.elevation*(1 + Math.cos(a))/2
      : layout.shape === 'knot' ? layout.elevation*(1 + Math.sin(3*a))/2
      : layout.elevation * Math.sin(layout.waves*a/2) ** 2;
    knots.push(new THREE.Vector3(x*layout.radiusX, 24+height, z*layout.radiusZ).applyMatrix4(rotation));
  }
  const curve = new THREE.CatmullRomCurve3(knots, true, 'centripetal');
  curve.arcLengthDivisions = 8192;
  const length = curve.getLength(), samples = Math.ceil(length/10);
  const points: TrackControlPoint[] = [];
  const worldUp = new THREE.Vector3(0,1,0);
  for (let i = 0; i < samples; i++) {
    const u = i / samples, tangent = curve.getTangentAt(u).normalize();
    const right = new THREE.Vector3().crossVectors(tangent,worldUp).normalize();
    const position = curve.getPointAt(u);
    let up = worldUp.clone(), section: TrackControlPoint['section'] = 'course';
    const stunt = layout.stunts.find(s => u >= s.start && u <= s.start+s.span);
    if (stunt) {
      const v = (u-stunt.start)/stunt.span, direction = stunt.direction ?? 1;
      const phase = v*Math.PI*2*stunt.turns, a = phase*direction;
      // Smooth radius envelopes give each stunt a flat, tangent-continuous entrance/exit.
      const ramp = Math.min(1,v*stunt.turns/.25,(1-v)*stunt.turns/.25);
      const envelope = ramp*ramp*(3-2*ramp);
      if (stunt.kind === 'loop') {
        position.addScaledVector(tangent,stunt.radius*Math.sin(phase)*envelope);
        // Opposite side offsets separate the rising/falling roads at the loop's projected crossing.
        position.addScaledVector(right,100*Math.sin(v*Math.PI*2)*Math.sin(v*Math.PI)**2);
        position.y += direction*stunt.radius*(1-Math.cos(phase));
        // Projecting the up hint onto the actual tangent is handled below.
        up.copy(worldUp).multiplyScalar(Math.cos(a)).addScaledVector(tangent,-Math.sin(a));
        section = 'vertical-loop';
      } else {
        if (stunt.kind === 'helix') {
          position.addScaledVector(right,stunt.radius*Math.sin(a)*envelope);
          position.y += stunt.radius*(1-Math.cos(a))*envelope;
        }
        up.copy(worldUp).multiplyScalar(Math.cos(a)).addScaledVector(right,-Math.sin(a));
        section = 'helix';
      }
    } else {
      const roll = layout.bank*Math.sin(u*Math.PI*2*layout.waves);
      up.multiplyScalar(Math.cos(roll)).addScaledVector(right,Math.sin(roll));
    }
    points.push({position,up,section});
  }
  // Downward loops hang below the approach; lift the entire closed route above the city floor.
  const lift = Math.max(0, 24 - Math.min(...points.map(point => point.position.y)));
  if (lift) for (const point of points) point.position.y += lift;
  // Loop normals follow the local vertical trajectory, even where forward motion reverses.
  for (let i = 0; i < points.length; i++) if (points[i].section === 'vertical-loop') {
    const direction = points[(i+1)%points.length].position.clone().sub(points[(i-1+points.length)%points.length].position).normalize();
    const axis = new THREE.Vector3().crossVectors(curve.getTangentAt(i/samples),worldUp).normalize();
    points[i].up.crossVectors(axis,direction).normalize();
  }
  return points;
}
