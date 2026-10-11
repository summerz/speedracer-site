import type { JumpCue } from '../track/trackJump.js';

export const JUMP_TIME_SCALE = .4;
export const JUMP_ORBIT_SECONDS = 4;
export const JUMP_CAMERA_SHOTS = ['orbit', 'bird', 'low', 'side'] as const;
export type JumpCameraShot = typeof JUMP_CAMERA_SHOTS[number];
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const u = clamp(x); return u * u * (3 - 2 * u); };
const smoother = (x: number) => { const u = clamp(x); return u * u * u * (u * (u * 6 - 15) + 10); };
// Continuous movement: 20% of the mean rate at takeoff, rising to 180% at landing.
const flightProgress = (u: number) => .2 * u + .8 * u * u;

/** Presentation offset only: altitude selection and swept landing judgment stay road-relative. */
export function jumpFlightPose(cue: JumpCue | null, distance: number, trackLength: number, reducedMotion = false) {
  if (cue?.phase !== 'airborne') return { lift: 0, pitch: 0 };
  const local = ((distance % trackLength) + trackLength) % trackLength;
  const u = clamp((local - cue.jump.start) / (cue.jump.end - cue.jump.start));
  if (reducedMotion) return { lift: Math.sin(Math.PI * u) ** 2, pitch: 0 };
  // Push upward as the craft leaves the road and the camera changes shot.
  // The first 4% of gap distance takes about half a real second under jump pacing.
  const takeoff = .04;
  const rise = u / takeoff, fall = (u - takeoff) / (1 - takeoff);
  return { lift: 6.5 * (u < takeoff ? smooth(rise) : 1 - smooth(fall)),
    pitch: u < takeoff ? -.24 * Math.sin(Math.PI * rise) : .16 * Math.sin(Math.PI * fall) };
}

/** One orbit at constant angular speed in real time, independent of simulation speed.
 * Only the short handoffs to/from the chase view blend; the orbit itself never eases.
 */
export function jumpCameraPose(age: number, duration = JUMP_ORBIT_SECONDS, reducedMotion = false, shot: JumpCameraShot = 'orbit') {
  if (reducedMotion) return { weight: 0, forward: -8.5, right: 0, up: 3.5, lookAhead: 9, lookUp: -.5 };
  const u = clamp(age / duration);
  if (shot === 'bird') {
    // A continuous climb/return, with a small rear offset to keep camera-up well-defined.
    return { weight: smooth(age / (duration * .3)) * (1 - smooth((u - .72) / .28)),
      forward: -2, right: .5, up: 22, lookAhead: .2, lookUp: 0 };
  }
  if (shot === 'low' || shot === 'side') {
    // Cut at takeoff, then cut back before the landing approach.
    const weight = age >= 0 && u < .89 ? 1 : 0;
    return shot === 'low'
      ? { weight, forward: -5 - 1.5 * u, right: 3.5, up: -3.5, lookAhead: 0, lookUp: 0 }
      : { weight, forward: -1.5, right: 10 - u, up: 1, lookAhead: 0, lookUp: 0 };
  }
  const angle = 2 * Math.PI * u;
  // Keep takeoff immediate, but match velocity and acceleration at both ends of
  // the handoff instead of catching the moving orbit camera in just 180ms.
  const weight = smoother(age / .55) * (1 - smooth((u - .97) / .03));
  return { weight, forward: -8.5 * Math.cos(angle), right: 8.5 * Math.sin(angle),
    up: 3.5 - 1.3 * Math.sin(angle / 2) ** 2, lookAhead: 9 * (1 - weight) + .5 * weight, lookUp: -.5 };
}

/** One common simulation delta drives player, rivals, race clock and moving hazards.
 * Real-time flight pacing aligns landing with the slow orbit, including boosted entry.
 * Recalculate from remaining distance/speed so acceleration doesn't cut the orbit short.
 * Braking/stopping still works: scale never exceeds normal time or teleports the craft.
 */
export function createJumpPresentation({ random = Math.random, shot }: { random?: () => number; shot?: JumpCameraShot | (() => JumpCameraShot | undefined) } = {}) {
  let airborne = false, age = 0, from = 1, scale = 1, duration = JUMP_ORBIT_SECONDS;
  let landingAge = Infinity, jumpId: string | null = null;
  let cameraShot: JumpCameraShot = 'orbit', lastShot: JumpCameraShot | null = null;
  let bag: JumpCameraShot[] = [];
  const pickShot = () => {
    const forced = typeof shot === 'function' ? shot() : shot;
    if (forced) return forced;
    if (!bag.length) {
      bag = [...JUMP_CAMERA_SHOTS];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag[0] === lastShot) [bag[0], bag[1]] = [bag[1], bag[0]];
    }
    lastShot = bag.shift()!;
    return lastShot;
  };
  return {
    reset() { airborne = false; age = 0; from = scale = 1; duration = JUMP_ORBIT_SECONDS; landingAge = Infinity; jumpId = null; cameraShot = 'orbit'; },
    step(cue: JumpCue | null, delta: number, reducedMotion = false, speed = 80) {
      const flying = cue?.phase === 'airborne';
      if (flying !== airborne) {
        landingAge = airborne && cue?.phase === 'landing' && cue.jump.id === jumpId ? 0 : Infinity;
        airborne = flying; age = 0; from = scale;
        if (flying) {
          duration = Math.max(JUMP_ORBIT_SECONDS, cue.distance / Math.max(1, speed) * 1.8);
          cameraShot = pickShot();
        }
      }
      if (flying) jumpId = cue.jump.id;
      const previousAge = age;
      age += delta; landingAge += delta;
      if (flying) {
        if (reducedMotion) scale = from + (JUMP_TIME_SCALE - from) * smooth(age / .12);
        else if (delta > 0) {
          const before = flightProgress(clamp(previousAge / duration)), after = flightProgress(clamp(age / duration));
          const fraction = before < 1 ? (after - before) / (1 - before) : 1;
          scale = speed > .5 && before < 1 ? Math.min(1, Math.max(.001, cue.distance * fraction / (speed * delta))) : 1;
        }
      } else scale = from + (1 - from) * smooth(age / .28);
      const landing = landingAge < .28 ? Math.sin(Math.PI * landingAge / .28) : 0;
      return { timeScale: scale, landing, cameraAge: airborne ? age : 0, cameraDuration: duration, cameraShot };
    },
  };
}
