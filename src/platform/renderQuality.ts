export type RenderQuality = 'low' | 'balanced' | 'high';
export const RENDER_QUALITIES: Record<RenderQuality, { label: string; pixelRatio: number }> = {
  low: { label: '성능 우선', pixelRatio: 0.75 },
  balanced: { label: '균형', pixelRatio: 1 },
  high: { label: '선명함', pixelRatio: 1.5 },
};
