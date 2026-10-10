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
  ['TRENCH ENTRY', 'abyss', 100, layout('ring', 500, 460, 32, [stunt('roll', .55, .18, 0, 1, 1)]), '해구 순환 · 완만한 노면 회전'],
  ['ABYSS FLOW', 'abyss', 112, layout('kidney', 540, 440, 55, [stunt('helix', .2, .2, 24, 1, -1), stunt('roll', .66, .16, 0, 1, -1)]), '해저 돔 곡선 · 코일과 회전'],
  ['PRESSURE LOOP', 'abyss', 115, layout('triangle', 500, 460, 76, [stunt('loop', .12, .09, 60, 1, -1), stunt('helix', .4, .2, 28, 1, 1), stunt('roll', .76, .14, 0, 1, 1)], 2), '하강 루프 · 압력 터널 코일'],
  ['RIFT DESCENT', 'abyss', 132, layout('eight', 560, 450, 145, [stunt('roll', .08, .12, 0, 1, -1), stunt('loop', .23, .065, 75, 1, 1), stunt('helix', .55, .2, 30, 2, -1), stunt('roll', .83, .12, 0, 1, 1)]), '해구 상하 교차 · 연속 입체 회전'],
  ['KELP PASSAGE', 'kelp', 102, layout('kidney', 480, 460, 32, [stunt('roll', .6, .18, 0, 1, -1)]), '해초 숲 통로 · 넓은 곡선'],
  ['CANOPY SWEEP', 'kelp', 113, layout('ring', 550, 470, 64, [stunt('helix', .18, .2, 24, 1, 1), stunt('roll', .7, .16, 0, 1, 1)], 2), '해초 기둥 순환 · 완만한 코일'],
  ['ROOT SPIRAL', 'kelp', 121, layout('thumb', 510, 460, 88, [stunt('helix', .1, .2, 26, 2, -1), stunt('roll', .43, .14, 0, 1, -1), stunt('loop', .72, .09, 62, 1, -1)]), '뿌리 사이 굽이 · 이중 코일과 루프'],
  ['FOREST WEAVE', 'kelp', 132, layout('clover', 530, 480, 112, [stunt('helix', .08, .18, 28, 2, 1), stunt('roll', .35, .13, 0, 1, 1), stunt('loop', .57, .09, 65, 1, 1), stunt('helix', .77, .17, 26, 1, -1)], 2), '숲 사이 세잎 곡선 · 연속 코일'],
  ['CORAL APPROACH', 'coral', 101, layout('triangle', 470, 460, 30, [stunt('roll', .56, .18, 0, 1, -1)]), '산호 정원 진입 · 완만한 삼각 순환'],
  ['REEF CIRCUIT', 'coral', 111, layout('kidney', 540, 440, 56, [stunt('loop', .2, .1, 58, 1, -1), stunt('roll', .69, .16, 0, 1, 1)]), '산호 군락 외곽 · 첫 수직 루프'],
  ['GARDEN HELIX', 'coral', 123, layout('clover', 520, 450, 84, [stunt('helix', .1, .2, 26, 2, 1), stunt('loop', .46, .09, 62, 1, 1), stunt('roll', .76, .15, 0, 1, -1)], 2), '정원 굽이 · 이중 코일과 루프'],
  ['CROWN CURRENT', 'coral', 134, layout('eight', 550, 450, 150, [stunt('loop', .23, .065, 75, 1, -1), stunt('roll', .38, .13, 0, 1, 1), stunt('helix', .55, .2, 30, 2, -1), stunt('roll', .82, .13, 0, 1, -1)]), '산호 왕관 교차 · 상하 해류'],
  ['LAGOON GLIDE', 'lagoon', 102, layout('ring', 520, 440, 26, [stunt('roll', .58, .18, 0, 1, 1)]), '얕은 바다 순환 · 수면빛 활주'],
  ['SUNLIT ARC', 'lagoon', 113, layout('triangle', 540, 470, 56, [stunt('helix', .18, .2, 24, 1, 1), stunt('roll', .7, .16, 0, 1, -1)]), '햇빛 곡선 · 넓은 코일'],
  ['TIDAL CROSSING', 'lagoon', 128, layout('eight', 530, 450, 128, [stunt('roll', .08, .13, 0, 1, 1), stunt('loop', .23, .065, 75, 1, 1), stunt('helix', .62, .22, 28, 2, -1)]), '밀물 상하 교차 · 루프와 코일'],
  ['SURFACE RUSH', 'lagoon', 138, layout('star', 560, 470, 108, [stunt('helix', .07, .19, 28, 2, 1), stunt('loop', .36, .09, 65, 1, -1), stunt('roll', .58, .13, 0, 1, -1), stunt('helix', .79, .17, 28, 1, -1)], 2), '수면빛 피날레 · 연속 입체 곡선'],
];

export const MARINE_TRACK_CATALOG: readonly TrackDefinition[] = Object.freeze(recipes.map(([name, district, lapLimit, course, features], index) => {
  const rating = index % 4 + 1;
  const altitudeLevels = rating <= 2 ? 2 : rating === 3 ? 3 : 4;
  return Object.freeze({
    id: name.toLowerCase().replaceAll(' ', '-'), name, district, order: 33 + index, revision: 1, rating,
    predecessor: index ? recipes[index - 1][0].toLowerCase().replaceAll(' ', '-') : null,
    laps: 3, lapLimit, halfWidth: rating <= 3 ? 14 : 13, altitudeLevels,
    obstacleLevels: Object.freeze(altitudeLevels === 2 ? [1, 0, 1, 0] : altitudeLevels === 3 ? [2, 0, 1, 2, 1, 0] : [3, 0, 1, 2, 3, 1, 2, 0]),
    layout: course, features,
  });
}));
