import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { advanceTrackDistance } from '../output/test/game/track/trackBranches.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';

export const challenges = ['easy', 'normal', 'hard'];
export function humanForkRun(track, fork, route, craft, boost = false, holdAfterLock = .2) {
  // Isolate road handling from intentional height/corridor hazards and pickups.
  const road = { ...track, heightObstacles: [], corridorObstacles: [], mineFields: [], arcRails: [], boostPads: [], boostRings: [], awakeningCores: [], jumps: [] };
  const model = createDrivingModel(road, craft.configuration.performance), s = model.state;
  const side = fork.routes.indexOf(route);
  const direction = fork.kind === 'vertical' ? 0 : fork.routes.length === 3 ? [-1, 0, 1][side] : side ? 1 : -1;
  const lap = fork.start < 180 ? track.length : 0;
  Object.assign(s, { distance: lap + fork.start - 180, speed: boost ? craft.configuration.performance.boostStage2Speed : craft.configuration.performance.topSpeed,
    altitudeLevel: fork.kind === 'vertical' && side ? track.altitudeProfile.levels.length - 1 : 0 });
  s.altitude = s.targetAltitude = track.altitudeProfile.levels[s.altitudeLevel];
  let lockedAt = null, chosen = null, peakOffset = 0, firstContact = null;
  const stop = lap + advanceTrackDistance(track, fork.start + fork.junctionLength, 100, route.id);
  for (let tick = 0; tick < 3600 && (s.distance < stop || (lockedAt !== null && s.elapsed - lockedAt < holdAfterLock + .4)); tick++) {
    if (lockedAt === null && s.distance >= lap + fork.start + fork.junctionLength) { lockedAt = s.elapsed; chosen = s.routeId; }
    // Full keyboard/touch input from the sign; 0.2 s reaction after lock,
    // then centre using only visible offset and heading (no curvature oracle).
    const steer = lockedAt === null || s.elapsed - lockedAt < holdAfterLock ? direction : Math.max(-1, Math.min(1, -s.offset * .08 - s.heading * 1.2));
    model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, steer, boost });
    peakOffset = Math.max(peakOffset, Math.abs(s.offset));
    if (firstContact === null && s.collisions + s.offTrackExits) firstContact = s.distance - lap - fork.start;
  }
  return { selected: chosen ?? s.routeId, reached: s.distance >= stop, collisions: s.collisions, exits: s.offTrackExits, peakOffset, firstContact };
}

export function forkGeometry(track, fork, route) {
  const lock = fork.start + fork.junctionLength;
  const stop = advanceTrackDistance(track, lock, 100, route.id);
  let peak = 0, headingRate = 0, whole = 0;
  for (let d = fork.start; d < fork.end; d = advanceTrackDistance(track, d, 1, route.id)) {
    const a = track.sample(d, undefined, route.id), b = track.sample(advanceTrackDistance(track, d, 1, route.id), undefined, route.id);
    whole = Math.max(whole, Math.abs(a.curvature));
    if (d <= stop) { peak = Math.max(peak, Math.abs(a.curvature)); headingRate = Math.max(headingRate, a.tangent.angleTo(b.tangent)); }
  }
  let spacing = Infinity;
  for (const other of fork.routes) if (other !== route) {
    // Dedicated mouths intentionally overlap. Measure the independent body,
    // using nearest 3D samples rather than mismatched shared-progress frames.
    const points = [];
    for (let d = other.mouthEnd; d <= other.mergeStart; d += 4) points.push(track.sample(d, undefined, other.id).position);
    for (let d = route.mouthEnd; d <= route.mergeStart; d += 4) {
      const p = track.sample(d, undefined, route.id).position;
      for (const q of points) spacing = Math.min(spacing, p.distanceTo(q));
    }
  }
  return { peak, whole, headingRate, lateralG: peak * 80 ** 2 / 9.81, spacing };
}

export function auditForks({ allCraft = false, holdAfterLock = .2 } = {}) {
  const rows = [];
  for (const definition of TRACK_CATALOG) {
    const track = createCatalogTrack(definition);
    for (const fork of track.branches ?? []) for (const route of fork.routes) {
      const geometry = forkGeometry(track, fork, route), runs = [];
      for (const challenge of challenges) {
        const variant = challenge === 'normal' ? track : createCatalogTrack(definition, challenge);
        for (const craft of allCraft ? DRONE_CATALOG : DRONE_CATALOG.slice(0, 2)) for (const boost of [false, true])
          runs.push({ challenge, craft: craft.configuration.id ?? craft.name, boost, ...humanForkRun(variant, fork, route, craft, boost, holdAfterLock) });
      }
      rows.push({ trackId: definition.id, name: definition.name, routeId: route.id, ...geometry,
        failures: runs.filter(r => !r.reached || r.selected !== route.id || r.collisions || r.exits), runs });
    }
  }
  return rows;
}
