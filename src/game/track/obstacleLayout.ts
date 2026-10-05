import type { HeightObstacle, Track } from './createTrack.js';

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

/** Positions stay fixed; the safe altitude changes once per run, shared by all racers. */
export function randomObstacleAltitudes(obstacles: readonly HeightObstacle[], levels: readonly number[], random: () => number): HeightObstacle[] {
  return obstacles.map(obstacle => {
    const value = random();
    const level = Number.isFinite(value) ? Math.max(0, Math.min(levels.length - 1, Math.floor(value * levels.length))) : 0;
    return obstacleAtLevel(obstacle, levels, level);
  });
}
