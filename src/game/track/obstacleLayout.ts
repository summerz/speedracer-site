import type { CorridorObstacle, HeightObstacle, Track } from './createTrack.js';

export function obstacleAtLevel(obstacle: HeightObstacle, levels: readonly number[], level: number): HeightObstacle {
  const height = levels[level];
  return { ...obstacle, kind: level === 0 ? 'descend' : level === levels.length - 1 ? 'rise' : 'middle',
    minAltitude: level === 0 ? levels[0] : height - .45,
    maxAltitude: level === levels.length - 1 ? levels.at(-1)! : height + .45 };
}

/** Extra fields prefer straight road; bends still leave room to change altitude. */
export function expandObstacleLayout(track: Track, authored: readonly HeightObstacle[]): HeightObstacle[] {
  if (!authored.length || track.length < 500) return [...authored];
  const baseCount = Math.ceil(authored.length * 1.35);
  const distances = Array.from({ length: baseCount }, (_, i) => 140 + i / baseCount * (track.length - 260));
  for (let i = 0; i < baseCount - 1; i++) {
    const midpoint = (distances[i] + distances[i + 1]) / 2;
    if (distances[i + 1] - distances[i] < 220) continue;
    const frames = [-45, 0, 45].map(offset => track.sample(midpoint + offset));
    if (frames.every(f => f.section === 'course' && Math.abs(f.curvature) < .0025 && Math.abs(f.tangent.y) < .4)) distances.push(midpoint);
  }
  return distances.sort((a, b) => a - b).map((distance, i) => ({ ...authored[i % authored.length], distance }));
}

/** Random index in [0,n) that never makes a third identical pick in a row. */
function sequencePicker(n: number, random: () => number) {
  const history: number[] = [];
  return () => {
    const value = random();
    let index = n > 1 && Number.isFinite(value) ? Math.max(0, Math.min(n - 1, Math.floor(value * n))) : 0;
    if (n > 1 && history.length === 2 && history[0] === index && history[1] === index) {
      const other = random();
      index = (index + 1 + (Number.isFinite(other) ? Math.max(0, Math.min(n - 2, Math.floor(other * (n - 1)))) : 0)) % n;
    }
    history.push(index); if (history.length > 2) history.shift();
    return index;
  };
}

/** Positions stay fixed; safe altitudes and moving-field phases change once per run, shared by all racers. */
export function randomObstacleAltitudes(obstacles: readonly HeightObstacle[], levels: readonly number[], random: () => number): HeightObstacle[] {
  // ponytail: branch routes share one sequence, so a streak can span two routes' fields.
  const pick = sequencePicker(levels.length, random);
  return obstacles.map(obstacle => {
    if (!obstacle.motion) return obstacleAtLevel(obstacle, levels, pick());
    const value = random(), cycle = obstacle.motion.stepSeconds * (levels.length - 1) * 2;
    return { ...obstacle, motion: { ...obstacle.motion, phase: Number.isFinite(value) ? Math.max(0, Math.min(.999999, value)) * cycle : 0 } };
  });
}

const LANES = ['left', 'center', 'right'] as const;

/** Corridor safe lanes change once per run; same formula as configureExtraObstacles. */
export function randomCorridorLanes(corridors: readonly CorridorObstacle[], halfWidth: number, random: () => number): CorridorObstacle[] {
  const pick = sequencePicker(3, random);
  return corridors.map(corridor => {
    const laneIndex = pick();
    return { ...corridor, safeCenter: (laneIndex - 1) * halfWidth * .58, lane: LANES[laneIndex] };
  });
}
