export const AI_OPPONENT_COUNT = 7;
export const RACE_PARTICIPANT_COUNT = AI_OPPONENT_COUNT + 1;

export type AiControlMode = 'desktop' | 'touch';
export type AiStyle = 'straight' | 'corner' | 'burst' | 'steady';
export interface AiRacer {
  id: string;
  name: string;
  modelVariant: string;
  color: string;
  style: AiStyle;
  rating: number;
}
export interface AiDrivingProfile {
  pace: number;
  cornerLimit: number;
  boostStartCharge: number;
  boostEndCharge: number;
  boostCurvature: number;
}

export const AI_STYLE_LABELS: Record<AiStyle, string> = {
  straight: '직선형', corner: '코너형', burst: '부스트형', steady: '안정형',
};

/** Identity, paint, craft and skill belong to the racer, not to a random race roll. */
export const AI_RACERS: readonly AiRacer[] = [
  { id: 'glint', name: 'GLINT', modelVariant: 'vanguard', color: '#f5d681', style: 'steady', rating: 1 },
  { id: 'ripple', name: 'RIPPLE', modelVariant: 'catamaran', color: '#6bd6ac', style: 'corner', rating: 1 },
  { id: 'spark', name: 'SPARK', modelVariant: 'halo', color: '#ee8cbe', style: 'burst', rating: 1 },
  { id: 'drift', name: 'DRIFT', modelVariant: 'needle', color: '#889aef', style: 'straight', rating: 1 },
  { id: 'cobalt', name: 'COBALT', modelVariant: 'hammerhead', color: '#648cff', style: 'steady', rating: 2 },
  { id: 'petal', name: 'PETAL', modelVariant: 'vanguard', color: '#ff70c5', style: 'corner', rating: 2 },
  { id: 'comet', name: 'COMET', modelVariant: 'needle', color: '#ffd96c', style: 'burst', rating: 2 },
  { id: 'relay', name: 'RELAY', modelVariant: 'halo', color: '#70ddb6', style: 'straight', rating: 2 },
  { id: 'ivory', name: 'IVORY', modelVariant: 'catamaran', color: '#eef3ff', style: 'steady', rating: 3 },
  { id: 'vortex', name: 'VORTEX', modelVariant: 'hammerhead', color: '#bf8bff', style: 'corner', rating: 3 },
  { id: 'flare', name: 'FLARE', modelVariant: 'vanguard', color: '#ff856e', style: 'burst', rating: 3 },
  { id: 'stride', name: 'STRIDE', modelVariant: 'needle', color: '#6bceaa', style: 'straight', rating: 3 },
  { id: 'frost', name: 'FROST', modelVariant: 'halo', color: '#c9e8ff', style: 'steady', rating: 4 },
  { id: 'orbit', name: 'ORBIT', modelVariant: 'catamaran', color: '#ffd2a1', style: 'corner', rating: 4 },
  { id: 'pulse', name: 'PULSE', modelVariant: 'hammerhead', color: '#ee74e1', style: 'burst', rating: 4 },
  { id: 'vector', name: 'VECTOR', modelVariant: 'vanguard', color: '#8bafff', style: 'straight', rating: 4 },
  { id: 'slate', name: 'SLATE', modelVariant: 'needle', color: '#dcdbff', style: 'steady', rating: 5 },
  { id: 'apex', name: 'APEX', modelVariant: 'halo', color: '#e6b96b', style: 'corner', rating: 5 },
  { id: 'surge', name: 'SURGE', modelVariant: 'catamaran', color: '#91e9c7', style: 'burst', rating: 5 },
  { id: 'lance', name: 'LANCE', modelVariant: 'hammerhead', color: '#ff9ebc', style: 'straight', rating: 5 },
  { id: 'aegis', name: 'AEGIS', modelVariant: 'vanguard', color: '#e9f2d8', style: 'steady', rating: 6 },
  { id: 'helix', name: 'HELIX', modelVariant: 'needle', color: '#da8bef', style: 'corner', rating: 6 },
  { id: 'nova', name: 'NOVA', modelVariant: 'hammerhead', color: '#ffc192', style: 'burst', rating: 6 },
  { id: 'razor', name: 'RAZOR', modelVariant: 'catamaran', color: '#97a4ff', style: 'straight', rating: 6 },
];

function hue(hex: string): number | null {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb, max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
  // Pale/white liveries remain distinct from the saturated player neon.
  if (delta < .2) return null;
  const value = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (value * 60 + 360) % 360;
}

export function distinctAiColor(color: string, playerColor: string): boolean {
  if (color.toLowerCase() === playerColor.toLowerCase()) return false;
  const a = hue(color), b = hue(playerColor);
  if (a === null || b === null) return true;
  const difference = Math.abs(a - b);
  return Math.min(difference, 360 - difference) >= 25;
}

/** Every model has several fixed liveries; selection avoids the player's nearby neon hue. */
export function selectAiRacer(modelVariant: string, playerColor: string, random: () => number, rating?: number, excluded: ReadonlySet<string> = new Set()): AiRacer {
  let candidates = AI_RACERS.filter(racer => !excluded.has(racer.id) && racer.modelVariant === modelVariant && distinctAiColor(racer.color, playerColor));
  if (rating !== undefined && candidates.length) {
    const nearest = Math.min(...candidates.map(r => Math.abs(r.rating - rating)));
    candidates = candidates.filter(r => Math.abs(r.rating - rating) <= Math.max(1, nearest));
  }
  if (!candidates.length) throw new Error(`No eligible Competition racer for ${modelVariant}`);
  return candidates[Math.floor(random() * candidates.length)];
}

/** Driver decisions change, while acceleration, steering, braking and collision tuning stay physical. */
export function aiDrivingProfile(racer: AiRacer, controlMode: AiControlMode): AiDrivingProfile {
  const skill = (racer.rating - 1) / 5;
  const style = {
    straight: { pace: 1, corner: -.02, charge: .48, end: .03 },
    corner: { pace: .96, corner: .07, charge: .55, end: .03 },
    burst: { pace: .98, corner: 0, charge: .34, end: .03 },
    steady: { pace: .93, corner: .02, charge: .72, end: .15 },
  }[racer.style];
  const touch = controlMode === 'touch';
  return {
    pace: (.82 + skill * .18) * style.pace * (touch ? .95 : 1),
    cornerLimit: (.5 + skill * .2 + style.corner + (racer.rating >= 5 ? touch ? .06 : .12 : 0)) * (touch ? .93 : 1),
    boostStartCharge: style.charge + (1 - skill) * .12 + (touch ? .05 : 0),
    boostEndCharge: style.end,
    boostCurvature: racer.style === 'straight' ? .0025 : .003,
  };
}
