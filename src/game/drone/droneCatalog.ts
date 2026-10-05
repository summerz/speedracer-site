import { DEFAULT_DRONE_CONFIGURATION, resolveDroneConfiguration } from './droneConfiguration.js';
import type { DroneConfiguration, DronePerformance } from './droneConfiguration.js';
import { steeringYawRate } from '../driving/createDrivingModel.js';
import { impactSpeedRetention } from '../driving/flightDynamics.js';

export interface DroneCatalogEntry {
  name: string;
  role: string;
  description: string;
  lineColor: string;
  configuration: DroneConfiguration;
}

function craft(name: string, role: string, description: string, lineColor: string, modelVariant: string,
  performance: Partial<DronePerformance>): DroneCatalogEntry {
  const base = DEFAULT_DRONE_CONFIGURATION;
  return { name, role, description, lineColor, configuration: resolveDroneConfiguration({
    ...base, id: modelVariant === 'vanguard' ? base.id : modelVariant, modelVariant,
    performance: { ...base.performance, ...performance },
    speedEffects: { ...base.speedEffects, referenceSpeed: performance.topSpeed ?? base.performance.topSpeed },
  }) };
}

/** Initial balance for testing. Shop ownership and prices are separate from race tuning. */
export const DRONE_CATALOG: readonly DroneCatalogEntry[] = [
  craft('Vanguard', '균형형', '가속과 선회가 균형 잡힌 기본 기체.', '#27eaff', 'vanguard', {}),
  craft('Needle', '최고속도형', '직선에서 가장 빠릅니다. 오르막·코너의 속도 손실과 좌우 미끄러짐이 큽니다.', '#b6ff3a', 'needle', {
    topSpeed: 100, boostSpeed: 145, boostStage2Speed: 175, acceleration: 42, boostAcceleration: 64, boostStage2Acceleration: 86,
    maxYawRate: 1.95, lateralBraking: 3, highSpeedSteeringLoss: 0.23, braking: 66, collisionSpeedLoss: 0.46,
    slopeSensitivity: 1.3, corneringDrag: .18, steeringDrag: 7, altitudeDrag: .65, downhillOverspeed: .14,
  }),
  craft('Hammerhead', '충돌 저항형', '오르막과 충돌에 강합니다. 강한 전진·좌우 제동으로 안정적으로 주행합니다.', '#ffb020', 'hammerhead', {
    topSpeed: 78, boostSpeed: 115, boostStage2Speed: 145, acceleration: 38, boostAcceleration: 58, boostStage2Acceleration: 78,
    maxYawRate: 2.05, lateralBraking: 10, highSpeedSteeringLoss: 0.18, braking: 90, collisionSpeedLoss: 0.24,
    slopeSensitivity: .7, corneringDrag: .11, steeringDrag: 4, altitudeDrag: .35, downhillOverspeed: .08,
  }),
  craft('Catamaran', '선회형', '빠른 좌우 반응과 즉각적인 좌우 제동. 코너에서 속도를 잘 유지합니다.', '#b04dff', 'catamaran', {
    topSpeed: 82, boostSpeed: 120, boostStage2Speed: 150, acceleration: 50, boostAcceleration: 72, boostStage2Acceleration: 94,
    maxYawRate: 2.65, lateralBraking: 14, highSpeedSteeringLoss: 0.14, braking: 78, collisionSpeedLoss: 0.42,
    slopeSensitivity: 1.05, corneringDrag: .075, steeringDrag: 2.8, altitudeDrag: .45, downhillOverspeed: .1,
  }),
  craft('Halo', '가속형', '빠르게 치고 나갑니다. 좌우로 살짝 미끄러지며 부스트 배터리는 빨리 소모됩니다.', '#ff3b3b', 'halo', {
    topSpeed: 90, boostSpeed: 135, boostStage2Speed: 170, acceleration: 60, boostAcceleration: 86, boostStage2Acceleration: 112,
    maxYawRate: 2.1, lateralBraking: 4.5, highSpeedSteeringLoss: 0.21, braking: 72, collisionSpeedLoss: 0.44, boostDrain: 0.24,
    slopeSensitivity: .85, corneringDrag: .14, steeringDrag: 5.2, altitudeDrag: .4, downhillOverspeed: .16,
  }),
];

/** Both hangar and future shop read the resolved race configuration, including equipped upgrades. */
export function droneStats(configuration: DroneConfiguration) {
  const p = configuration.performance;
  return [
    { label: '가속도', value: p.acceleration.toFixed(0), unit: 'm/s²', fill: p.acceleration / 70, hint: '높을수록 빠르게 가속' },
    { label: '최고 속도', value: (p.topSpeed * 3.6).toFixed(0), unit: 'km/h', fill: p.topSpeed / 110, hint: `평지 기준 · 부스트 ${(p.boostSpeed * 3.6).toFixed(0)} · 2단계 ${(p.boostStage2Speed * 3.6).toFixed(0)} km/h` },
    { label: '좌우 핸들링', value: (steeringYawRate(60, p) * 180 / Math.PI).toFixed(0), unit: '°/s', fill: steeringYawRate(60, p) / 2.2, hint: '216 km/h 기준 · 높을수록 민첩' },
    { label: '좌우 제동', value: (Math.log(10) / p.lateralBraking).toFixed(2), unit: 's', fill: p.lateralBraking / 18, hint: '입력 해제 후 잔류 방향 90% 감소 · 짧을수록 즉각 제동' },
    { label: '충돌 감속', value: ((1 - impactSpeedRetention(p.collisionSpeedLoss)) * 100).toFixed(0), unit: '%', fill: impactSpeedRetention(p.collisionSpeedLoss), hint: '벽 충돌 기준 · 낮을수록 유리' },
  ];
}
