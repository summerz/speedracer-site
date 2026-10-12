import { DRONE_CATALOG } from '../drone/droneCatalog.js';
import { resolveDroneConfiguration } from '../drone/droneConfiguration.js';
import type { DroneConfiguration } from '../drone/droneConfiguration.js';

export const STARTER_ID = DRONE_CATALOG[0].configuration.id;
export const CRAFT_PRICES: Readonly<Record<string, number>> = {
  [STARTER_ID]: 0, needle: 1200, hammerhead: 1000, catamaran: 900, halo: 1400,
};
export const CRAFT_RESALE_RATE = .8;
export const craftResaleValue = (id: string): number => Math.floor((CRAFT_PRICES[id] ?? 0) * CRAFT_RESALE_RATE);
export const UPGRADE_COSTS = [300, 500, 800] as const;
export const UPGRADES = [
  { id: 'engine', name: '추진기', description: '단계당 최고 속도 +4% · 가속 +3% · 등판 저항 -4%' },
  { id: 'brakes', name: '브레이크', description: '단계당 제동력 +12%' },
  { id: 'steering', name: '자세 제어', description: '단계당 조향 +5% · 선회 저항 -6% · 조향 저항 -8%' },
  { id: 'stabilizer', name: '횡방향 안정기', description: '단계당 좌우 제동력 +25% · 입력 해제·반대 조향 시 미끄러짐 감소' },
  { id: 'battery', name: '부스트 배터리', description: '단계당 소모 -5% · 회복 +4%' },
] as const;
export type UpgradeId = typeof UPGRADES[number]['id'];
export type UpgradeLevels = Record<UpgradeId, number>;
export const emptyLevels = (): UpgradeLevels => ({ engine: 0, brakes: 0, steering: 0, stabilizer: 0, battery: 0 });
export const FOCUS_PRICE = 60;
export const INVENTORY_LIMIT = 99;
export const FOCUS_DURATION = 5;
export const FOCUS_MOTION_SCALE = .3;
export const FOCUS_DESCRIPTION = '5초 동안 모든 기체의 주행 속도를 70% 낮춥니다. 경기 시계는 정상적으로 흐릅니다.';
export const RIVAL_ITEMS = [
  { id: 'speed-10', name: '기본 속도 강화 10%', price: 500, duration: 0, description: '출발 때 자동 사용 · 레이스 내내 일반 주행 최고 속도 +10%. 경기당 1개 소비 · 가장 높은 강화만 적용.' },
  { id: 'speed-20', name: '기본 속도 강화 20%', price: 800, duration: 0, description: '출발 때 자동 사용 · 레이스 내내 일반 주행 최고 속도 +20%. 경기당 1개 소비 · 가장 높은 강화만 적용.' },
  { id: 'speed-30', name: '기본 속도 강화 30%', price: 1100, duration: 0, description: '출발 때 자동 사용 · 레이스 내내 일반 주행 최고 속도 +30%. 경기당 1개 소비 · 가장 높은 강화만 적용.' },
  { id: 'head-start', name: '선행 출발', price: 100, duration: 5, description: '출발 때 자동 사용 · 상대가 5초 늦게 출발합니다. 여러 개 장착해도 경기당 1개만 소비합니다.' },
  { id: 'boost-10', name: '부스트 강화 10%', price: 400, duration: 0, description: '출발 때 자동 사용 · 레이스 내내 부스트 속도 +10%. 경기당 1개 소비 · 가장 높은 강화만 적용.' },
  { id: 'boost-20', name: '부스트 강화 20%', price: 600, duration: 0, description: '출발 때 자동 사용 · 레이스 내내 부스트 속도 +20%. 경기당 1개 소비 · 가장 높은 강화만 적용.' },
  { id: 'boost-30', name: '부스트 강화 30%', price: 800, duration: 0, description: '출발 때 자동 사용 · 레이스 내내 부스트 속도 +30%. 경기당 1개 소비 · 가장 높은 강화만 적용.' },
  { id: 'support-missile', name: '지원 미사일', price: 100, duration: 5, description: '2랩부터 나를 추월한 상대 한 대에게 자동 발사합니다. 0.4초 비행 후 5초 정지 · 장착 수량만큼, 매번 새로운 추월에 반응.' },
  { id: 'time-stop', name: '시간 정지', price: 120, duration: 3, description: '상대 기체를 3초 동안 멈춥니다. 내 기체와 경기 시계는 계속 움직입니다.' },
  { id: 'interference', name: '전파 교란', price: 100, duration: 3, description: '앞쪽 180m 안의 가장 가까운 상대 기체 최대 2대의 목표 속도를 3초 동안 50%로 낮춥니다.' },
] as const;
export type RivalItemId = typeof RIVAL_ITEMS[number]['id'];
export const boostItemBonus = (id: string): number => id === 'boost-10' ? .1 : id === 'boost-20' ? .2 : id === 'boost-30' ? .3 : 0;
export const speedItemBonus = (id: string): number => id === 'speed-10' ? .1 : id === 'speed-20' ? .2 : id === 'speed-30' ? .3 : 0;
export const isStartItem = (id: string): boolean => id === 'head-start' || boostItemBonus(id) > 0 || speedItemBonus(id) > 0;
export const isAutomaticItem = (id: string): boolean => id === 'support-missile' || isStartItem(id);
export const itemAllowedInMode = (id: string, mode: string): boolean => mode === 'competition' || boostItemBonus(id) > 0 || speedItemBonus(id) > 0;
export const emptyItemInventory = (): Record<RivalItemId, number> => Object.fromEntries(RIVAL_ITEMS.map(item => [item.id, 0])) as Record<RivalItemId, number>;
export const isRivalItem = (id: unknown): id is RivalItemId => RIVAL_ITEMS.some(item => item.id === id);

/** Permanent upgrades apply once to the base craft; never compound previous results. */
export function upgradedConfiguration(craftId: string, levels: UpgradeLevels): DroneConfiguration {
  const entry = DRONE_CATALOG.find(craft => craft.configuration.id === craftId);
  if (!entry) throw new RangeError('Unknown craft');
  return applyUpgrades(entry.configuration, levels);
}
export const MAX_UPGRADE_LEVEL = 3;
export function applyUpgrades(base: DroneConfiguration, levels: UpgradeLevels): DroneConfiguration {
  for (const { id } of UPGRADES) if (!Number.isInteger(levels[id]) || levels[id] < 0 || levels[id] > MAX_UPGRADE_LEVEL) throw new RangeError('Invalid upgrade level');
  return resolveDroneConfiguration(base, [{ performanceMultiplier: {
    topSpeed: 1 + levels.engine * .04, boostSpeed: 1 + levels.engine * .04, boostStage2Speed: 1 + levels.engine * .04,
    acceleration: 1 + levels.engine * .03, boostAcceleration: 1 + levels.engine * .03, boostStage2Acceleration: 1 + levels.engine * .03,
    braking: 1 + levels.brakes * .12, maxYawRate: 1 + levels.steering * .05,
    lateralBraking: 1 + levels.stabilizer * .25,
    highSpeedSteeringLoss: 1 - levels.steering * .08,
    slopeSensitivity: 1 - levels.engine * .04, corneringDrag: 1 - levels.steering * .06, steeringDrag: 1 - levels.steering * .08,
    boostDrain: 1 - levels.battery * .05, boostRecovery: 1 + levels.battery * .04,
  } }]);
}
