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
  { id: 'engine', name: '추진기', description: '단계당 최고 속도 +4% · 가속 +3%' },
  { id: 'brakes', name: '브레이크', description: '단계당 제동력 +12%' },
  { id: 'steering', name: '자세 제어', description: '단계당 조향 +5% · 고속 조향 손실 감소' },
  { id: 'battery', name: '부스트 배터리', description: '단계당 소모 -5% · 회복 +4%' },
] as const;
export type UpgradeId = typeof UPGRADES[number]['id'];
export type UpgradeLevels = Record<UpgradeId, number>;
export const emptyLevels = (): UpgradeLevels => ({ engine: 0, brakes: 0, steering: 0, battery: 0 });
export const FOCUS_PRICE = 60;
export const INVENTORY_LIMIT = 99;

/** Permanent upgrades apply once to the base craft; never compound previous results. */
export function upgradedConfiguration(craftId: string, levels: UpgradeLevels): DroneConfiguration {
  const entry = DRONE_CATALOG.find(craft => craft.configuration.id === craftId);
  if (!entry) throw new RangeError('Unknown craft');
  for (const { id } of UPGRADES) if (!Number.isInteger(levels[id]) || levels[id] < 0 || levels[id] > 3) throw new RangeError('Invalid upgrade level');
  return resolveDroneConfiguration(entry.configuration, [{ performanceMultiplier: {
    topSpeed: 1 + levels.engine * .04, boostSpeed: 1 + levels.engine * .04, boostStage2Speed: 1 + levels.engine * .04,
    acceleration: 1 + levels.engine * .03, boostAcceleration: 1 + levels.engine * .03, boostStage2Acceleration: 1 + levels.engine * .03,
    braking: 1 + levels.brakes * .12, maxYawRate: 1 + levels.steering * .05,
    highSpeedSteeringLoss: 1 - levels.steering * .08,
    boostDrain: 1 - levels.battery * .05, boostRecovery: 1 + levels.battery * .04,
  } }]);
}
