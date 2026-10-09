export type EdgeLevel = 'warn' | 'danger' | 'calm';
export interface Edge { tone: 'rail' | 'corridor'; level: EdgeLevel }
export interface HazardEdgeAlert { left: Edge | null; right: Edge | null; arrow: 'left' | 'right' | null }
interface Guide { distance: number; safe: boolean }

/** Screen-edge cue for lateral hazards. `distance` is <= 0 while inside a section, so the same comparisons cover "inside". */
export function hazardEdgeAlert({ corridor, arcRail, speed }: { corridor: (Guide & { lane: 'left' | 'center' | 'right' }) | null; arcRail: (Guide & { side: -1 | 1 }) | null; speed: number }): HazardEdgeAlert {
  const out: HazardEdgeAlert = { left: null, right: null, arrow: null };
  const near = (guide: Guide) => guide.distance < Math.max(120, speed * 3);
  const level = (guide: Guide): EdgeLevel => guide.safe ? 'calm' : guide.distance < Math.max(35, speed * 1.5) ? 'danger' : 'warn';
  if (corridor && near(corridor)) {
    const edge: Edge = { tone: 'corridor', level: level(corridor) };
    if (corridor.lane !== 'left') out.left = edge;
    if (corridor.lane !== 'right') out.right = edge;
    if (!corridor.safe && corridor.lane !== 'center') out.arrow = corridor.lane;
  }
  if (arcRail && near(arcRail)) {
    out[arcRail.side > 0 ? 'right' : 'left'] = { tone: 'rail', level: level(arcRail) };
    out.arrow = arcRail.safe ? null : arcRail.side > 0 ? 'left' : 'right';
  }
  return out;
}
