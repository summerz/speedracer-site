import type { RaceChallengeId } from './raceChallenge.js';

export type HazardId = 'static-field' | 'moving-field' | 'corridor' | 'minefield' | 'arc-rail' | 'boost-pad' | 'boost-ring';
export interface HazardEntry {
  readonly id: HazardId;
  readonly name: string;
  readonly kind: 'hazard' | 'boost';
  readonly colour: string;
  readonly sections: 'course' | 'stunt' | 'any';
  readonly enabled: boolean;
  readonly effect: string;
}

/** Source of truth for every hazard and boost type; docs/HAZARDS.md mirrors it (tests/hazardCatalog.test.mjs). */
export const HAZARD_CATALOG: readonly HazardEntry[] = [
  { id: 'static-field', name: '전기선', kind: 'hazard', colour: '청백색 접지 기둥 사이 전기 아크', sections: 'course', enabled: true, effect: '안전 고도 밖으로 지나가면 방전 접촉, 속도 손실' },
  { id: 'moving-field', name: '이동 전기선', kind: 'hazard', colour: '청백색 전기 아크, 안전 구멍이 오르내림', sections: 'course', enabled: true, effect: '움직이는 안전 고도 밖이면 방전 접촉' },
  { id: 'corridor', name: '좁은 주행 통로', kind: 'hazard', colour: '주황색 방전 벽, 안전 통로는 흰 안내선', sections: 'course', enabled: true, effect: '안전 통로 밖이면 방전 접촉' },
  { id: 'minefield', name: '전기 지뢰밭', kind: 'hazard', colour: '자홍색 기둥 무리와 경고 띠', sections: 'course', enabled: false, effect: '기둥에 닿으면 방전 접촉, 안전한 선은 항상 통과 가능' },
  { id: 'arc-rail', name: '아크 레일', kind: 'hazard', colour: '라임색 전기 레일, 한쪽 절반만 활성', sections: 'stunt', enabled: true, effect: '활성 쪽 절반에 걸리면 방전 접촉' },
  { id: 'boost-pad', name: '부스트 패드', kind: 'boost', colour: '청록색 화살표 판', sections: 'course', enabled: true, effect: '지나가면 부스트 게이지 35% 충전과 즉시 가속' },
  { id: 'boost-ring', name: '부스트 링', kind: 'boost', colour: '청록색 고리', sections: 'any', enabled: true, effect: '고리 안으로 지나가면 부스트 게이지 30% 충전과 가속' },
];

export const hazardEnabled = (id: HazardId) => HAZARD_CATALOG.find(h => h.id === id)!.enabled;

/** Average metres of road per field (static + moving + corridor, plus minefields when enabled) on each path. */
export const HAZARD_GAP = { easy: 420, normal: 330, hard: 260 } as const satisfies Record<RaceChallengeId, number>;
/** Share of each path's fields that are corridors / moving fields (mines only while enabled); the remainder is static. */
export const HAZARD_SHARE = {
  easy: { corridor: .20, moving: .10, mine: .10 }, normal: { corridor: .25, moving: .25, mine: .20 }, hard: { corridor: .30, moving: .30, mine: .25 },
} as const;
/** Boosts per km of road, whichever kind the track uses. */
export const BOOSTS_PER_KM = { easy: 1.0, normal: .8, hard: .6 } as const satisfies Record<RaceChallengeId, number>;
/** Arc rails per track, on randomly chosen stunt sections each run (fewer if the track has fewer). */
export const ARC_RAILS_PER_TRACK = { easy: 1, normal: 1, hard: 2 } as const satisfies Record<RaceChallengeId, number>;

export type BoostKind = 'pad' | 'ring';
/** One boost kind per track: stable FNV-1a hash of the track key, about half each; an enabled kind wins over a disabled one. */
export function boostKindFor(key: string): BoostKind {
  const pad = hazardEnabled('boost-pad'), ring = hazardEnabled('boost-ring');
  if (pad !== ring) return pad ? 'pad' : 'ring';
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
  return (hash >>> 29 & 1) ? 'ring' : 'pad';
}
