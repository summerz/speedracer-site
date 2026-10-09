import { upcomingFork, forkAt, branchChoiceOpen, forkApproachDrift } from '../track/trackBranches.js';
import { RACE_CHALLENGES, type RaceChallengeId } from '../track/raceChallenge.js';
import { DRONE_CATALOG } from '../drone/droneCatalog.js';
import { resolveDroneConfiguration } from '../drone/droneConfiguration.js';
import type { DroneConfiguration } from '../drone/droneConfiguration.js';
import { upcomingHeightObstacle } from '../track/createTrack.js';
import { resolveHeightObstacle, obstacleArrivalTime, upcomingCorridor } from '../track/obstacleDynamics.js';
import { CRAFT_HALF_WIDTH, mineLineOffset, MINE_CHAIN_SLOPE } from '../track/mineField.js';
import type { MineField } from '../track/createTrack.js';
import type { Track } from '../track/createTrack.js';
import { steeringYawRate } from './createDrivingModel.js';
import type { DrivingInput, DrivingState } from './createDrivingModel.js';
import type { RaceRules } from './createTimeAttack.js';
import { createTimeAttack } from './createTimeAttack.js';
import { createRaceRecords } from './raceRecords.js';
import { aiDrivingProfile, AI_STYLE_LABELS, AI_OPPONENT_COUNT, selectAiRacer } from './aiRoster.js';
import type { AiControlMode, AiDrivingProfile } from './aiRoster.js';
import { RIVAL_ITEMS, isRivalItem, applyUpgrades, MAX_UPGRADE_LEVEL } from '../progression/catalog.js';
import type { RivalItemId } from '../progression/catalog.js';

/** Rival upgrade level by device and challenge; weakest-rated rivals sit one level lower. */
const RIVAL_LEVELS = { desktop: { easy: 1, normal: 2, hard: 3 }, touch: { easy: 0, normal: 1, hard: 2 } } as const;
/** Top-3 rated rivals chase a leader more than 80 m ahead, fading out within 30 m. */
const CATCH_UP = { desktop: .03, touch: .03 } as const;
export type RaceMode = 'time-attack' | 'competition';
export interface Standing {
  id: string; name: string; color: string; player: boolean;
  distance: number; completedLaps: number; finishTime: number | null; rank: number;
  craftName?: string; style?: string; rating?: number;
  effect?: RivalItemId | null;
}
export interface CompetitionSnapshot {
  standings: Standing[]; playerRank: number; complete: boolean;
}

/** Unwrapped distance separates lapped runners; interpolated finish times decide finish order. */
export function rankParticipants(entries: Omit<Standing, 'rank'>[]): Standing[] {
  return [...entries].sort((a, b) => {
    if (a.finishTime !== null && b.finishTime !== null) return a.finishTime - b.finishTime || Number(b.player) - Number(a.player) || a.id.localeCompare(b.id);
    if (a.finishTime !== null) return -1;
    if (b.finishTime !== null) return 1;
    return b.distance - a.distance || Number(b.player) - Number(a.player) || a.id.localeCompare(b.id);
  }).map((entry, i) => ({ ...entry, rank: i + 1 }));
}

type ContactPose = Pick<DrivingState, 'distance' | 'offset' | 'altitude'>;

/** Seven opponents covering all four other models; injected randomness keeps simulations repeatable. */
export function selectRivalCrafts(configuration: DroneConfiguration, random: () => number = Math.random) {
  const candidates = DRONE_CATALOG.filter(entry => entry.configuration.modelVariant !== configuration.modelVariant);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return Array.from({ length: AI_OPPONENT_COUNT }, (_, index) => candidates[index % candidates.length]);
}
/** Swept track-space boxes catch fast overtakes, including racers a lap apart and the start seam. */
export function craftContact(a0: ContactPose, a1: ContactPose, b0: ContactPose, b1: ContactPose, length: number): boolean {
  const d0 = a0.distance - b0.distance;
  const nearestLap = Math.round(d0 / length) * length;
  const starts = [d0 - nearestLap, a0.offset - b0.offset, a0.altitude - b0.altitude];
  const ends = [a1.distance - b1.distance - nearestLap, a1.offset - b1.offset, a1.altitude - b1.altitude];
  const sizes = [4.4, 3.2, 1.1];
  let enter = 0, leave = 1;
  for (let axis = 0; axis < 3; axis++) {
    const velocity = ends[axis] - starts[axis];
    if (Math.abs(velocity) < 1e-9) { if (Math.abs(starts[axis]) > sizes[axis]) return false; continue; }
    const x = (-sizes[axis] - starts[axis]) / velocity, y = (sizes[axis] - starts[axis]) / velocity;
    enter = Math.max(enter, Math.min(x, y)); leave = Math.min(leave, Math.max(x, y));
    if (enter > leave) return false;
  }
  return true;
}

/** AI makes ordinary driving decisions; it never writes speed, distance or lap progress. */
export function aiDrivingInput(track: Track, configuration: DroneConfiguration, state: DrivingState,
  index: number, opponents: readonly DrivingState[], profile?: AiDrivingProfile, speedScale = 1): DrivingInput {
  const p = configuration.performance;
  const fork = branchChoiceOpen(track, state.distance) ? forkAt(track, state.distance) : upcomingFork(track, state.distance, Math.max(150, state.speed * 2));
  const branchSide = (index + Math.floor(state.distance / track.length) + (p.topSpeed > 100 ? 1 : 0)) % 2;
  const routeId = state.routeId ?? fork?.routes[branchSide].id;
  const curvature = track.sample(state.distance, undefined, routeId).curvature;
  let bend = Math.abs(curvature);
  // Short sampling intervals catch tight bends between the old lookahead points.
  for (let ahead = 10; ahead <= 60; ahead += 10) bend = Math.max(bend, Math.abs(track.sample(state.distance + ahead, undefined, routeId).curvature));
  const difficulty = track.altitudeProfile.levels.length;
  const pace = (difficulty === 2 ? .96 : 1) * (profile?.pace ?? 1);
  const boost = bend < (profile?.boostCurvature ?? .003) && !state.boostNeedsRelease &&
    (state.boosting ? state.charge > (profile?.boostEndCharge ?? .03) : state.charge > (profile?.boostStartCharge ?? .5));
  const desiredSpeed = (boost ? p.boostStage2Speed : p.topSpeed) * pace * speedScale;
  // Keep some yaw available for lane corrections, even with a full boost reserve.
  const cornerLimit = Math.min(profile?.cornerLimit ?? .74, steeringYawRate(desiredSpeed, p) * .85);
  let goalSpeed = Math.min(desiredSpeed, cornerLimit / Math.max(.001, bend));
  // A fast craft needs more than 60m to brake for a hairpin. Work backwards from
  // each bend using braking distance rather than slowing immediately for far bends.
  for (let ahead = 70; ahead <= 280; ahead += 10) {
    const turnSpeed = cornerLimit / Math.max(.001, Math.abs(track.sample(state.distance + ahead, undefined, routeId).curvature));
    goalSpeed = Math.min(goalSpeed, Math.sqrt(turnSpeed ** 2 + 2 * p.braking * .7 * (ahead - 25)));
  }
  const edge = track.halfWidth - 3.5;
  const laneWidth = Math.min(5.2, edge * .7);
  const preferredLane = (index % 3 - 1) * laneWidth + Math.sin(state.distance / 210 + index * 2) * .65;
  const traffic = opponents.filter(other => {
    if ((other.routeId ?? null) !== (state.routeId ?? null)) return false;
    const ahead = ((other.distance - state.distance) % track.length + track.length) % track.length;
    const lookAhead = Math.max(35, (desiredSpeed - other.speed) * 1.3 + 12);
    // Start a pass before the speed difference closes the gap; hold clearance until fully past.
    return (ahead < lookAhead || ahead > track.length - 8) && Math.abs(other.altitude - state.altitude) < 1.5;
  });
  let lane = [preferredLane, -laneWidth, laneWidth, 0].find(candidate =>
    traffic.every(other => Math.abs(other.offset - candidate) >= 4.2)) ?? preferredLane;
  lane = Math.max(-edge, Math.min(edge, lane));
  // A pad within 120 m is worth a lane change only when no field follows it within 150 m, or the pad lane is that corridor's safe lane (never before a mine field).
  const ahead = (distance: number, from: number) => ((distance - from) % track.length + track.length) % track.length;
  const onRoute = (o: { routeId?: string }) => !o.routeId || o.routeId === state.routeId;
  const pad = (track.boostPads ?? []).filter(onRoute).map(pad => ({ pad, gap: ahead(pad.distance, state.distance) }))
    .filter(({ gap }) => gap <= 120).sort((a, b) => a.gap - b.gap)[0];
  if (pad) {
    const after = (o: { distance: number }) => ahead(o.distance, pad.pad.distance) <= 150;
    const follow = (track.corridorObstacles ?? []).find(o => onRoute(o) && after(o));
    const clear = !track.heightObstacles.some(o => onRoute(o) && after(o)) && !(track.mineFields ?? []).some(o => onRoute(o) && after(o))
      && (!follow || follow.lane === pad.pad.lane);
    if (clear) lane = pad.pad.center;
  }
  const corridor = upcomingCorridor(track, state.distance, state.routeId);
  const enteringCorridor = corridor && corridor.distance < Math.max(130, state.speed * 1.8);
  if (enteringCorridor) lane = corridor.obstacle.safeCenter;
  // Mine field: slide onto its safe line before it, then follow line and slope until it ends (inside a field wins over the next one's approach).
  let lineSlope = 0, following = false;
  const into = (field: MineField) => ((state.distance - field.distance) % track.length + track.length) % track.length;
  const fields = (track.mineFields ?? []).filter(onRoute);
  const field = fields.find(f => into(f) < f.length) ?? fields.filter(f => track.length - into(f) <= 150).sort((a, b) => into(b) - into(a))[0];
  if (field) {
    const along = into(field), inside = along < field.length, gap = track.length - along, entry = mineLineOffset(field, 0);
    // The slide starts after the last corridor/height field before this one has been cleared (at most 150 m ahead).
    const ramp = Math.min(150, ...[...track.heightObstacles, ...track.corridorObstacles ?? []].filter(onRoute).map(o => {
      const before = ((field.distance - o.distance) % track.length + track.length) % track.length;
      return before < 150 + o.depth / 2 ? before - o.depth / 2 - 4 : Infinity;
    }));
    if (inside || gap <= ramp) {
      lineSlope = inside ? (mineLineOffset(field, along + 2) - mineLineOffset(field, along)) / 2 : (entry - lane) / ramp;
      lane = inside ? mineLineOffset(field, along) : lane + (entry - lane) * (ramp - gap) / ramp; following = true;
    }
  }
  // Arc rails: hold the safe half of the segment you are in (or the next one within 200 m), switching in the gaps. A ring is taken when it
  // lies on the safe side of every segment before it and of the next one after it, or that next segment is 180 m away.
  const wrap = (x: number) => (x % track.length + track.length) % track.length;
  const segments = (track.arcRails ?? []).filter(onRoute).flatMap(r => r.segments.map(g => {
    const before = wrap(r.distance + g.at - state.distance), start = before > track.length - g.length ? before - track.length : before;
    return { start, end: start + g.length, side: g.side };
  }));
  const inside = segments.find(g => g.start <= 0), segment = inside ?? segments.filter(g => g.start <= 200).sort((a, b) => a.start - b.start)[0];
  if (segment) lane = [0, 2.5, 5].map(extra => -segment.side * (CRAFT_HALF_WIDTH + 1.5 + extra)).find(candidate => traffic.every(other => Math.abs(other.offset - candidate) >= 4.2)) ?? -segment.side * (CRAFT_HALF_WIDTH + 1.5);
  const ring = (track.boostRings ?? []).filter(onRoute).map(r => ({ r, gap: wrap(r.distance - state.distance) })).filter(({ gap }) => gap <= 120).sort((a, b) => a.gap - b.gap)[0];
  if (ring && segments.every(g => g.start >= ring.gap ? g.start - ring.gap >= 180 || g.side * ring.r.offset < 0 : g.end > ring.gap || g.side * ring.r.offset < 0)) lane = ring.r.offset;
  // Single file on a line: nobody can pass, so hold the pace of a craft right ahead instead of ramming it.
  if (following) for (const other of traffic) {
    const gap = ((other.distance - state.distance) % track.length + track.length) % track.length;
    if (gap < 60 && Math.abs(other.offset - state.offset) < 3.6) goalSpeed = Math.min(goalSpeed, other.speed + Math.max(0, gap - 10) * .4);
  }
  const next = upcomingHeightObstacle(track, state.distance, state.routeId);
  let lift = 0;
  if (next && next.distance < Math.max(110, state.speed * 3)) {
    const opening = resolveHeightObstacle(next.obstacle, track.altitudeProfile.levels,
      obstacleArrivalTime(track, state.elapsed, next.distance, state.speed, next.obstacle.depth, state.distance, state.routeId));
    const level = track.altitudeProfile.levels.map((height, index) => ({ height, index }))
      .filter(({ height }) => height >= opening.minAltitude && height <= opening.maxAltitude)
      .sort((a, b) => Math.abs(a.index - state.altitudeLevel) - Math.abs(b.index - state.altitudeLevel))[0]?.index ?? -1;
    if (level >= 0) lift = Math.sign(level - state.altitudeLevel);
  }
  if (fork) {
    if (fork.kind === 'horizontal') { if (!following && !segment) lane = branchSide ? 3.5 : -3.5; }
    else if (!next || next.distance > fork.start - state.distance % track.length)
      lift = Math.sign((branchSide ? track.altitudeProfile.levels.length - 1 : 0) - state.altitudeLevel);
  }
  // Pull toward the lane, but never ask for a sideways slope beyond what the stabilizer can hold (heading gain 14 x MINE_CHAIN_SLOPE),
  // or the craft overshoots the lane and, for a weakly damped one, the road edge.
  const lateralPull = following ? Math.max(-14 * MINE_CHAIN_SLOPE, Math.min(14 * MINE_CHAIN_SLOPE, (lane - state.offset) * .5)) : (lane - state.offset) * .14;
  // Dampen lane changes after a pickup: a fully boosted craft otherwise swings
  // past its preferred lane and reaches the opposite road edge.
  return { throttle: true, brake: state.speed > goalSpeed + 1, boost,
    steer: (curvature * forkApproachDrift(track, state.distance) * state.speed - (state.heading - lineSlope) * (following ? 14 : enteringCorridor ? 8 : 4.2) + lateralPull) / Math.max(.1, steeringYawRate(state.speed, p)), lift };
}

/** One clock, countdown and pause lifecycle for both modes; completed pilots become ghosts. */
export function createRaceSession(track: Track, configuration: DroneConfiguration,
  records: ReturnType<typeof createRaceRecords>, focusSlots = 0, mode: RaceMode = 'time-attack',
  random: () => number = Math.random, controlMode: AiControlMode = 'desktop', rules: RaceRules = {}, rating?: number, rivalSlots: readonly RivalItemId[] = [], challenge: RaceChallengeId = 'normal') {
  if (rivalSlots.length && mode !== 'competition' || rivalSlots.length + focusSlots > 2 || !rivalSlots.every(isRivalItem)) throw new Error('Invalid race item loadout');
  let itemCooldown = 0;
  const itemUsed: RivalItemId[] = [];
  const player = createTimeAttack(track, configuration.performance, records, focusSlots, rules);
  const craft = DRONE_CATALOG.find(c => c.configuration.modelVariant === configuration.modelVariant);
  const playerColor = craft?.lineColor ?? configuration.boostStyle.pulseColor;
  const candidates = mode === 'competition' ? selectRivalCrafts(configuration, random) : [];
  const usedRacers = new Set<string>();
  const baseRating = rating ?? 3;
  const fieldRatings = [6, 5, Math.min(6, baseRating + 1), baseRating, baseRating, Math.max(1, baseRating - 1), 1];
  const rivals = candidates.map((entry, index) => {
    const racer = selectAiRacer(entry.configuration.modelVariant, playerColor, random, Math.max(1, Math.min(6, fieldRatings[index] + RACE_CHALLENGES[challenge].aiRating)), usedRacers);
    usedRacers.add(racer.id);
    const { color } = racer;
    const profile = aiDrivingProfile(racer, controlMode);
    profile.pace *= RACE_CHALLENGES[challenge].aiPace;
    const level = Math.max(0, Math.min(MAX_UPGRADE_LEVEL, RIVAL_LEVELS[controlMode][challenge] - (racer.rating <= 2 ? 1 : 0)));
    const speed = challenge === 'hard' ? controlMode === 'touch' ? 1.015 : 1.03 : 1;
    const upgraded = resolveDroneConfiguration(applyUpgrades(entry.configuration, { engine: level, brakes: level, steering: level, stabilizer: level, battery: level }),
      [{ performanceMultiplier: { topSpeed: speed, boostSpeed: speed, boostStage2Speed: speed } }]);
    const rivalConfiguration = { ...upgraded, boostStyle: {
      core: '#ffffff', body: color, tail: color, afterglow: color, pulseColor: color,
    } };
    return {
      id: `ai-${racer.id}`, name: racer.name, craftName: entry.name, color, racer, effects: { freeze: 0, jam: 0 },
      style: AI_STYLE_LABELS[racer.style], rating: racer.rating, profile, configuration: rivalConfiguration,
      controller: createTimeAttack(track, rivalConfiguration.performance,
        createRaceRecords({ trackId: 'ai-memory', laps: rules.laps, configurationId: racer.id }), focusSlots, { laps: rules.laps }),
    };
  });
  const chasers = new Set([...rivals].sort((a, b) => b.rating - a.rating).slice(0, 3));
  const participants = [{ id: 'player', name: craft?.name ?? 'PLAYER',
    color: playerColor, craftName: craft?.name ?? 'PLAYER', style: '', rating: 0, configuration, controller: player }, ...rivals];
  const contacts = new Map<string, number>();
  let clock = 0;
  const grid = () => {
    contacts.clear(); clock = 0; track.obstacleTime = 0; itemCooldown = 0; itemUsed.length = 0;
    rivals.forEach((rival, index) => {
      rival.effects.freeze = 0; rival.effects.jam = 0;
      rival.controller.model.state.distance = -(index + 1) * 7;
      rival.controller.model.state.offset = (index % 3 - 1) * Math.min(4.5, track.halfWidth - 3.5);
    });
  };
  grid();
  const competition = (): CompetitionSnapshot | null => {
    if (!rivals.length) return null;
    const standings = rankParticipants(participants.map(p => {
      const s = p.controller.snapshot();
      return { id: p.id, name: p.name, color: p.color, player: p === participants[0], craftName: p.craftName, style: p.style, rating: p.rating,
        distance: p.controller.model.state.distance, completedLaps: s.completedLaps, finishTime: s.finishTime,
        effect: 'effects' in p ? p.effects.freeze > 0 ? 'time-stop' as const : p.effects.jam > 0 ? 'interference' as const : null : null };
    }));
    return { standings, playerRank: standings.find(p => p.player)!.rank, complete: standings.every(p => p.finishTime !== null) };
  };
  const targets = (item: RivalItemId) => {
    const active = rivals.filter(rival => rival.controller.phase === 'running');
    if (item === 'time-stop') return active;
    const distance = player.model.state.distance;
    return active.filter(rival => rival.controller.model.state.distance > distance && rival.controller.model.state.distance <= distance + 180)
      .sort((a, b) => a.controller.model.state.distance - b.controller.model.state.distance).slice(0, 2);
  };
  const itemRemaining = (item: RivalItemId) => rivalSlots.filter(id => id === item).length - itemUsed.filter(id => id === item).length;
  const canUseRivalItem = (item: RivalItemId) => player.phase === 'running' && itemCooldown <= 1e-8 && itemRemaining(item) > 0 && targets(item).length > 0;
  return {
    model: player.model, rivals, controlMode,
    get phase() { return player.phase; },
    snapshot() { const snapshot = player.snapshot(); return { ...snapshot, mode, competition: competition(),
      assisted: snapshot.assisted || rivalSlots.length > 0, canFocus: snapshot.canFocus && itemCooldown <= 1e-8, itemCooldown,
      items: RIVAL_ITEMS.map(item => ({ id: item.id, remaining: itemRemaining(item.id), canUse: canUseRivalItem(item.id),
        active: Math.max(0, ...rivals.map(rival => item.id === 'time-stop' ? rival.effects.freeze : rival.effects.jam)),
        targets: targets(item.id).map(rival => rival.name) })) }; },
    start() {
      const fresh = player.phase === 'ready' || player.phase === 'finished';
      if (fresh) track.randomizeObstacles?.(random);
      player.start(); rivals.forEach(p => fresh ? p.controller.restart() : p.controller.start()); if (fresh) grid();
    },
    restart() { track.randomizeObstacles?.(random); player.restart(); rivals.forEach(p => p.controller.restart()); grid(); },
    pause() { player.pause(); rivals.forEach(p => p.controller.pause()); },
    recover() { player.recover(); },
    useAwakening() { return player.useAwakening(); },
    useFocus() {
      if (itemCooldown > 1e-8 || !player.useFocus()) return false;
      itemCooldown = 3;
      rivals.forEach(p => p.controller.useFocus()); return true;
    },
    useRivalItem(item: RivalItemId) {
      if (!isRivalItem(item) || !canUseRivalItem(item)) return false;
      const affected = targets(item);
      for (const rival of affected) {
        if (item === 'time-stop') rival.effects.freeze = 1;
        else rival.effects.jam = 3;
      }
      itemUsed.push(item); itemCooldown = 3; return true;
    },
    step(delta: number, input: DrivingInput) {
      const dt = Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, .1));
      if (player.phase === 'ready' || player.phase === 'paused' || dt === 0) return;
      if (!rivals.length) {
        let remaining = dt, first = true;
        while (remaining > 1e-8) {
          const step = Math.min(remaining, 1 / 120); remaining -= step;
          const before = player.model.state.elapsed;
          player.step(step, { ...input, lift: first ? input.lift : 0 }); first = false;
          clock += player.model.state.elapsed - before; track.obstacleTime = clock;
          if (player.phase === 'running') itemCooldown = Math.max(0, itemCooldown - step);
        }
        return;
      }
      // Small shared substeps keep contact decisions stable across rendering frame rates.
      let remaining = dt; let firstStep = true;
      while (remaining > 1e-8) {
        const boundaries = rivals.flatMap(rival => [rival.effects.freeze, rival.effects.jam]).filter(time => time > 1e-8);
        const step = Math.min(remaining, 1 / 120, ...boundaries); remaining -= step;
        const before = participants.map(p => ({ ...p.controller.model.state }));
        const active = participants.map(p => p.controller.phase === 'running');
        player.step(step, { ...input, lift: firstStep ? input.lift : 0 }); firstStep = false;
        rivals.forEach((rival, index) => {
          const opponents = participants.filter(p => p !== rival && p.controller.phase !== 'finished').map(p => p.controller.model.state);
          const gap = Math.max(0, ...opponents.map(o => o.distance)) - rival.controller.model.state.distance;
          const chase = challenge !== 'easy' && chasers.has(rival) ? 1 + CATCH_UP[controlMode] * Math.max(0, Math.min(1, (gap - 30) / 50)) : 1;
          const controls = aiDrivingInput(track, rival.configuration, rival.controller.model.state, index, opponents, rival.profile, rival.effects.jam > 1e-8 ? .5 : chase);
          rival.controller.step(step, { ...controls, ...(rival.effects.jam > 1e-8 ? { targetSpeedScale: .5 } : {}) }, rival.effects.freeze > 1e-8);
          rival.effects.freeze = Math.max(0, rival.effects.freeze - step);
          rival.effects.jam = Math.max(0, rival.effects.jam - step);
        });
        clock += Math.max(0, ...participants.map((p, i) => p.controller.model.state.elapsed - before[i].elapsed));
        track.obstacleTime = clock;
        if (player.phase === 'running') itemCooldown = Math.max(0, itemCooldown - step);
        for (let a = 0; a < participants.length; a++) for (let b = a + 1; b < participants.length; b++) {
          if (!active[a] || !active[b] || participants[a].controller.phase !== 'running' || participants[b].controller.phase !== 'running') continue;
          const key = `${a}:${b}`;
          const sa = participants[a].controller.model.state, sb = participants[b].controller.model.state;
          if (sa.awakeningRemaining > 0 || sb.awakeningRemaining > 0 || before[a].awakeningRemaining > 0 || before[b].awakeningRemaining > 0
            || clock < (contacts.get(key) ?? 0) || !craftContact(before[a], sa, before[b], sb, track.length)) continue;
          // Separate branches can share progress/altitude while being metres apart in world space.
          if (sa.routeId !== sb.routeId || sa.routeId || sb.routeId) {
            const fa = track.sample(sa.distance, undefined, sa.routeId), fb = track.sample(sb.distance, undefined, sb.routeId);
            const pa = fa.position.addScaledVector(fa.right, sa.offset).addScaledVector(fa.up, sa.altitude);
            const pb = fb.position.addScaledVector(fb.right, sb.offset).addScaledVector(fb.up, sb.altitude);
            if (pa.distanceToSquared(pb) > 6 ** 2) continue;
          }
          participants[a].controller.model.contact(); participants[b].controller.model.contact();
          contacts.set(key, clock + .7);
        }
      }
    },
  };
}
