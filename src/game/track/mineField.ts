import type { MineField } from './createTrack.js';

export const CRAFT_HALF_WIDTH = 1.6, CRAFT_HALF_LENGTH = 2.2;
/**
 * Max lateral slope (m sideways per m forward) of a mine field's safe line.
 * Stock vanguard at boost stage 2 (155 m/s): full-steer yaw rate = 2.2 / (1 + 155*.006 + sqrt(155-60)*.2) = .567 rad/s
 * (steeringYawRate); the side-slip stabilizer (lateralBraking 7/s) balances it at .567/7 = .0810 rad, so the craft can hold
 * tan(.0810) = .0812 m/m; half of that is .0406, rounded down.
 */
// ponytail: derived constant, not tuned; recompute if the vanguard's maxYawRate/lateralBraking or stage-2 speed change (tests/mineField.test.mjs checks it).
export const MINE_LINE_SLOPE = .04;
/** Sideways slope a craft can hold between two fields (the stabilizer-limited side-slip above, undivided): bounds how far back-to-back entries may differ. */
export const MINE_CHAIN_SLOPE = .08;
/** Same speed loss as a discharge field. */
export const MINE_SPEED_RETENTION = .35;
const STEP = 2, WINDOW = 29.5, MAX_GAP = 14.5;

export const mineLane = (offset: number, halfWidth: number) => offset < -halfWidth / 3 ? 0 : offset > halfWidth / 3 ? 2 : 1;

/** Linear lookup on the field's safe line. */
export function mineLineOffset(field: Pick<MineField, 'line'>, at: number) {
  const { line } = field, last = line.length - 1;
  const i = Math.max(0, Math.min(last - 1, Math.floor((at - line[0].at) / STEP)));
  const t = Math.max(0, Math.min(1, (at - line[i].at) / (line[i + 1].at - line[i].at)));
  return line[i].offset + (line[i + 1].offset - line[i].offset) * t;
}

/**
 * A fresh field: a smooth safe line (random start, slope <= MINE_LINE_SLOPE, random-walk drift), then mines in the other
 * lanes (`anchor`: the previous field's exit and how far its entry may lie from it). Mines sit >= craft half width + radius + 1 m from the line, consecutive mines are in different lanes, and any two
 * neighbours are <= 29.5 m apart, so every 30 m window blocks at least two lanes. The line itself is always passable.
 */
export function createMineField(distance: number, routeId: string | undefined, size: { length: number; mines: number; radius: number },
  halfWidth: number, random: () => number, anchor?: { offset: number; reach: number }): MineField {
  const { length, mines: count, radius } = size, bound = halfWidth - CRAFT_HALF_WIDTH - .5;
  const line: { at: number; offset: number }[] = [];
  const [lo, hi] = anchor ? [Math.max(-bound, anchor.offset - anchor.reach), Math.min(bound, anchor.offset + anchor.reach)] : [-bound, bound];
  let offset = lo + random() * (hi - lo), slope = 0;
  for (let at = 0; at <= length; at += STEP) {
    line.push({ at, offset });
    slope = Math.max(-MINE_LINE_SLOPE, Math.min(MINE_LINE_SLOPE, slope + ((random() * 2 - 1) * MINE_LINE_SLOPE - slope) * .3));
    if (Math.abs(offset + slope * STEP) > bound) slope = -slope;
    offset = Math.max(-bound, Math.min(bound, offset + slope * STEP));
  }
  const field = { line }, reach = halfWidth - radius - .4, edges = [-reach, -halfWidth / 3, halfWidth / 3, reach];
  const nominal = Math.min(MAX_GAP, (length - 8) / (count - 1));
  const room = (gaps: number[]) => {
    const span = gaps.reduce((a, b) => a + b, 0);
    return { lo: Math.max(3, length - WINDOW - (span - gaps.at(-1)!)), hi: Math.min(WINDOW - gaps[0], length - 3 - span) };
  };
  let gaps = Array.from({ length: count - 1 }, () => nominal * (.7 + .3 * random())), span = room(gaps);
  if (span.lo > span.hi) { gaps = gaps.map(() => nominal); span = room(gaps); }
  const sites = [span.lo + random() * (span.hi - span.lo)];
  for (const gap of gaps) sites.push(sites.at(-1)! + gap);
  const clear = CRAFT_HALF_WIDTH + radius + 1 + .05;
  let previous = -1;
  const mines = sites.map(at => {
    const centre = mineLineOffset(field, at);
    // Lane intervals minus the line's keep-out zone.
    const free = (lane: number) => [[edges[lane], Math.min(edges[lane + 1], centre - clear)], [Math.max(edges[lane], centre + clear), edges[lane + 1]]]
      .filter(([lo, hi]) => hi - lo > .05);
    let lanes = [0, 1, 2].filter(lane => lane !== previous && free(lane).length);
    if (!lanes.length) lanes = [0, 1, 2].filter(lane => free(lane).length);
    previous = lanes[Math.min(lanes.length - 1, Math.floor(random() * lanes.length))];
    const segments = free(previous);
    let pick = random() * segments.reduce((sum, [lo, hi]) => sum + hi - lo, 0), offset = segments.at(-1)![1];
    for (const [lo, hi] of segments) { if (pick <= hi - lo) { offset = lo + pick; break; } pick -= hi - lo; }
    return { at, offset, radius };
  });
  return { routeId, distance, length, mines, line };
}
