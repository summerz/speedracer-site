import type { BranchRecipe } from './trackBranches.js';
import type { TrackDefinition } from './trackCatalog.js';
import type { CourseLayout, CourseShape } from './trackAuthoring.js';

type MarineDistrict = 'abyss' | 'kelp' | 'coral' | 'lagoon';
type Stunt = CourseLayout['stunts'][number];
const stunt = (kind: Stunt['kind'], start: number, span: number, radius = 0, turns = 1, direction: 1 | -1 = 1): Stunt =>
  Object.freeze({ kind, start, span, radius, turns, direction });
const layout = (shape: CourseShape, radiusX: number, radiusZ: number, elevation: number, stunts: readonly Stunt[], waves = 1): CourseLayout =>
  Object.freeze({ shape, radiusX, radiusZ, elevation, waves, bank: .16, rotation: 0, stunts: Object.freeze(stunts) });

// Each district starts with a forgiving route, then introduces more altitude and rotation.
const recipes: readonly [string, MarineDistrict, number, CourseLayout, string][] = [
  ['TRENCH ENTRY', 'abyss', 110, layout('crescent', 410, 390, 80, [stunt('roll', .64, .22, 0, 1, 1)]), '비대칭 해구 · 긴 협곡 · 긴 노면 회전'],
  ['ABYSS FLOW', 'abyss', 145, layout('horseshoe', 600, 530, 180, [stunt('helix', .6, .28, 78, 2, -1)]), '말굽 심해 순환 · 대형 하강 코일 2회전'],
  ['PRESSURE LOOP', 'abyss', 135, layout('triangle', 610, 550, 110, [stunt('loop', .12, .085, 125, 1, -1), stunt('roll', .69, .16, 0, 1, 1)]), '삼각 압력 분지 · 대형 하강 루프 · 기술/가속 분기'],
  ['RIFT DESCENT', 'abyss', 180, layout('knot', 410, 370, 280, [stunt('roll', .08, .16, 0, 2, -1), stunt('helix', .5, .34, 68, 3, 1)]), '입체 해구 매듭 · 깊은 하강 코일 3회전 · 720° 롤'],
  ['KELP PASSAGE', 'kelp', 110, layout('slalom', 550, 520, 45, [stunt('roll', .68, .16, 0, 1, -1)]), '평행 숲길 슬라럼 · 반대 방향 노면 회전'],
  ['CANOPY SWEEP', 'kelp', 138, layout('kidney', 660, 540, 120, [stunt('helix', .13, .23, 58, 1, 1)]), '비대칭 캐노피 상승 · 상하 분기 · 큰 상승 코일'],
  ['ROOT SPIRAL', 'kelp', 150, layout('thumb', 630, 570, 130, [stunt('helix', .25, .34, 64, 3, -1)]), '엄지형 뿌리 순환 · 긴 코일 3회전'],
  ['FOREST WEAVE', 'kelp', 170, layout('slalom', 630, 600, 150, [stunt('helix', .08, .16, 48, 1, 1), stunt('roll', .4, .16, 0, 2, 1), stunt('helix', .73, .18, 54, 1, -1)]), '숲 왕복 슬라럼 · 좌우 분기 · 양방향 코일 · 720° 롤'],
  ['CORAL APPROACH', 'coral', 112, layout('diamond', 620, 550, 55, [stunt('roll', .56, .22, 0, 1, -1)]), '넓은 마름모 광장 · 완전 회전'],
  ['REEF CIRCUIT', 'coral', 142, layout('ring', 660, 600, 70, [stunt('loop', .14, .085, 120, 1, 1), stunt('roll', .75, .13, 0, 1, 1)]), '산호 원형 경기장 · 대형 수직 루프 · 위험별 3갈래'],
  ['GARDEN HELIX', 'coral', 158, layout('clover', 630, 570, 140, [stunt('helix', .1, .25, 60, 2, 1), stunt('helix', .61, .25, 66, 2, -1)], 2), '세 잎 정원 · 대형 양방향 코일 2회전씩'],
  ['CROWN CURRENT', 'coral', 180, layout('eight', 580, 480, 220, [stunt('loop', .23, .065, 135, 1, -1), stunt('helix', .57, .24, 66, 2, -1)]), '입체 산호 8자 · 대형 하강 루프 · 위험별 3갈래'],
  ['LAGOON GLIDE', 'lagoon', 138, layout('ring', 780, 550, 45, [stunt('loop', .2, .08, 155, 1, 1)]), '탁 트인 대형 타원 · 초대형 수직 루프'],
  ['SUNLIT ARC', 'lagoon', 158, layout('crescent', 500, 440, 110, [stunt('loop', .14, .075, 145, 1, 1), stunt('roll', .61, .22, 0, 2, -1)]), '수면 초승달 아치 · 대형 상승 루프 · 720° 롤'],
  ['TIDAL CROSSING', 'lagoon', 180, layout('eight', 640, 530, 220, [stunt('helix', .57, .24, 62, 2, -1)]), '넓은 수면 8자 · 입체 교차 분기 · 긴 코일'],
  ['SURFACE RUSH', 'lagoon', 182, layout('star', 700, 600, 150, [stunt('loop', .12, .075, 130, 1, -1), stunt('helix', .63, .24, 60, 2, 1)], 2), '넓은 수면 별 순환 · 대형 루프 · 하강 점프 분기'],
];
const forkRecipes: Partial<Record<number, Omit<BranchRecipe, 'id'>>> = {
  2: { kind: 'horizontal', experience: 'prism', routeNames: ['압력 회랑', '해구 익스프레스'] },
  5: { kind: 'vertical', experience: 'city', variety: 'terrace-height', routeNames: ['뿌리 슬라럼', '캐노피 익스프레스'] },
  7: { kind: 'horizontal', experience: 'city', direction: -1, routeNames: ['숲 안쪽 굽이', '숲 바깥 순환'] },
  9: { kind: 'horizontal', experience: 'arena', variety: 'arena-three', routeNames: ['산호 고도길', '리프 크루즈', '리프 부스트'] },
  11: { kind: 'horizontal', experience: 'arena', variety: 'arena-three', direction: -1, routeNames: ['크라운 고도길', '크라운 차선', '크라운 부스트'] },
  14: { kind: 'horizontal', experience: 'orbit', intertwined: true, groundClearance: 24, routeNames: ['조류 코일', '수면 교차'] },
  15: { kind: 'horizontal', experience: 'sky', routeNames: ['수면 아치', '라군 점프'] },
};

export const MARINE_TRACK_CATALOG: readonly TrackDefinition[] = Object.freeze(recipes.map(([name, district, lapLimit, course, features], index) => {
  const id = name.toLowerCase().replaceAll(' ', '-');
  const rating = index % 4 + 1;
  const altitudeLevels = rating <= 2 ? 2 : rating === 3 ? 3 : 4;
  return Object.freeze({
    id, name, district, order: 33 + index, revision: 2, rating,
    predecessor: index ? recipes[index - 1][0].toLowerCase().replaceAll(' ', '-') : null,
    laps: 3, lapLimit, halfWidth: rating <= 3 ? 14 : 13, altitudeLevels,
    obstacleLevels: Object.freeze(altitudeLevels === 2 ? [1, 0, 1, 0] : altitudeLevels === 3 ? [2, 0, 1, 2, 1, 0] : [3, 0, 1, 2, 3, 1, 2, 0]),
    layout: course,
    branches: Object.freeze(forkRecipes[index] ? [Object.freeze({ ...forkRecipes[index]!, id: `${id}-fork` }) as BranchRecipe] : []),
    jumps: Object.freeze(index === 15 ? [Object.freeze({ id: 'surface-rush-drop', branchId: `${id}-fork`, routeIndex: 1 as const })] : []), features,
  });
}));
