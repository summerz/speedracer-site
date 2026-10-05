import type { DronePerformance } from '../drone/droneConfiguration.js';

export interface FlightLoads {
  /** Signed world-space climb: -1 straight down, +1 straight up. */
  grade: number;
  /** Full 3D path curvature, including automatically followed loops and coils (1/m). */
  curvature: number;
  steer: number;
  altitudeSpeed: number;
}

/** Arcade thrust/drag balance. Nominal speed is the flat, straight equilibrium. */
export function flightAcceleration(speed: number, nominalSpeed: number, thrust: number,
  performance: DronePerformance, loads: FlightLoads): number {
  const gravity = 18 * performance.slopeSensitivity * loads.grade;
  const corner = performance.corneringDrag * speed * speed * Math.abs(loads.curvature);
  const steering = performance.steeringDrag * loads.steer ** 2 * Math.min(2, speed / performance.topSpeed);
  const altitude = performance.altitudeDrag * Math.abs(loads.altitudeSpeed);
  // Bound resistance so a tight automatic loop cannot stall a full-throttle craft.
  const maneuverDrag = Math.min(thrust > 0 ? thrust * .55 : 25, corner + steering + altitude);
  // Keep full launch thrust until ~71% of nominal speed, then settle smoothly.
  // The steeper balance near cruise preserves the sharp arcade/boost response.
  const balance = Math.max(-2, Math.min(1, 2 * (1 - (speed / nominalSpeed) ** 2)));
  const propulsion = thrust > 0 ? thrust * balance : -5;
  return propulsion - gravity - maneuverDrag;
}

/** Arcade grip: climbs tighten control, descents loosen it; loops stay bounded. */
export function slopeHandling(grade: number) {
  return 1 + Math.max(-1, Math.min(1, grade)) * .22;
}

/** Resistance upgrades still matter; all contact types lose slightly more speed. */
export function impactSpeedRetention(loss: number, severity = 1) {
  return Math.max(.05, 1 - loss * severity * 1.15);
}

/** A short propulsion dip, rather than a stop or a fixed recovery speed. */
export function impactAccelerationScale(remaining: number, duration: number) {
  return 1 - .65 * Math.max(0, Math.min(1, remaining / duration));
}
