import type { DistrictId } from './trackCatalog.js';

export type LandmarkKind = 'terrace' | 'bridge' | 'reactor' | 'arena' | 'dome' | 'spire' | 'orbital-ring';
/** Shared definitions for race geometry, previews and the generated usage documentation. */
export const LANDMARK_TYPES: Record<LandmarkKind, { name: string; height: number; description: string }> = {
  terrace: { name: '계단형 주거 타워', height: 122, description: '높이가 다른 주거 타워와 층별 창 조명' },
  bridge: { name: '쌍둥이 연결교', height: 112, description: '두 타워 사이를 잇는 공중 연결교' },
  reactor: { name: '전력 코어', height: 100, description: '중앙 반응로의 발광 띠와 외곽 전력 기둥' },
  arena: { name: '원형 경기장', height: 100, description: '층층이 쌓인 원형 관중석과 조명 마스트' },
  dome: { name: '발광 돔', height: 100, description: '반구형 연구 시설과 교차하는 발광 아치' },
  spire: { name: '첨탑', height: 217, description: '층별 조명, 뾰족한 상부와 수직 발광 축' },
  'orbital-ring': { name: '궤도 링', height: 112, description: '양면 테두리가 빛나는 거대한 기울어진 원형 구조물' },
};
interface LandmarkDistrict {
  signature: readonly LandmarkKind[];
  companions: readonly [LandmarkKind, LandmarkKind];
  accents: readonly [string, string, string];
}
export const LANDMARK_DISTRICTS: Record<DistrictId, LandmarkDistrict> = {
  residential: { signature: ['terrace', 'bridge'], companions: ['orbital-ring', 'bridge'], accents: ['#ffca70', '#c6a0ff', '#ff8eb4'] },
  industrial: { signature: ['reactor', 'spire'], companions: ['orbital-ring', 'reactor'], accents: ['#b8f6ee', '#ffcf89', '#ffa7c7'] },
  stadium: { signature: ['arena', 'dome'], companions: ['bridge', 'orbital-ring'], accents: ['#ffda86', '#a2efff', '#e5b5ff'] },
  skyline: { signature: ['spire', 'bridge'], companions: ['orbital-ring', 'spire'], accents: ['#ffd4a1', '#b7ffec', '#ffc1db'] },
  research: { signature: ['dome', 'reactor'], companions: ['spire', 'dome'], accents: ['#aefff0', '#ffdfa5', '#ffc0dc'] },
  orbital: { signature: ['orbital-ring', 'bridge'], companions: ['dome', 'orbital-ring'], accents: ['#b7d5ff', '#ffc7dd', '#b2fff4'] },
  harbor: { signature: ['bridge', 'orbital-ring'], companions: ['spire', 'bridge'], accents: ['#ffbd79', '#a5ffe8', '#ffaad3'] },
  desert: { signature: ['reactor', 'terrace'], companions: ['dome', 'reactor'], accents: ['#93efff', '#bcffa5', '#ffc194'] },
  abyss: { signature: ['dome', 'dome'], companions: ['dome', 'bridge'], accents: ['#5ff5e6', '#ff7aa8', '#9de6ff'] },
};
export const LANDMARK_ENCOUNTERS = [
  { fraction: .08, scale: 3.1 }, { fraction: .38, scale: 2.15 }, { fraction: .72, scale: 1.65 },
] as const;
