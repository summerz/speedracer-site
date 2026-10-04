import { CRAFT_PRICES, craftResaleValue, emptyLevels, FOCUS_PRICE, INVENTORY_LIMIT, STARTER_ID, UPGRADES, UPGRADE_COSTS } from './catalog.js';
import type { UpgradeId, UpgradeLevels } from './catalog.js';
import type { DifficultyId } from '../track/difficulty.js';

export interface RewardInput {
  raceId: string; difficulty: DifficultyId; collisions: number; offTrackExits: number; recoveries: number;
  penaltyPoints: number; improvedExistingBest: boolean; assisted: boolean;
}
export interface Reward { base: number; clean: number; best: number; penalty: number; total: number; assisted: boolean }
export interface Progress {
  version: 1; revision: number; balance: number; owned: string[]; equipped: string;
  upgrades: Record<string, UpgradeLevels>; focus: number; focusSlots: number;
  rewards: Record<string, Reward>;
  focusUses: Record<string, 'pending' | 'used' | 'refunded'>;
}
export const initialProgress = (): Progress => ({ version: 1, revision: 0, balance: 0, owned: [STARTER_ID], equipped: STARTER_ID,
  upgrades: { [STARTER_ID]: emptyLevels() }, focus: 0, focusSlots: 0, rewards: {}, focusUses: {} });
const integer = (n: unknown, max = Number.MAX_SAFE_INTEGER): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= max;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (object: object, key: string) => Object.hasOwn(object, key);
export function validateProgress(value: unknown): Progress {
  if (record(value) && value.focusUses === undefined) value = { ...value, focusUses: {} };
  if (!record(value) || value.version !== 1 || !integer(value.revision) || !integer(value.balance)
    || !Array.isArray(value.owned) || !value.owned.length || new Set(value.owned).size !== value.owned.length
    || !value.owned.every(id => typeof id === 'string' && own(CRAFT_PRICES, id)) || !value.owned.includes(STARTER_ID)
    || !value.owned.includes(value.equipped) || !record(value.upgrades) || !record(value.rewards)
    || !record(value.focusUses) || !integer(value.focus, INVENTORY_LIMIT) || !integer(value.focusSlots, 2)) throw new Error('진행 저장 데이터가 올바르지 않습니다.');
  if (Object.keys(value.upgrades).length !== value.owned.length) throw new Error('잘못된 강화 데이터');
  for (const id of value.owned) {
    const levels = value.upgrades[id];
    if (!record(levels) || Object.keys(levels).length !== UPGRADES.length || !UPGRADES.every(upgrade => integer(levels[upgrade.id], 3))) throw new Error('잘못된 강화 데이터');
  }
  for (const [id, state] of Object.entries(value.focusUses as Record<string, unknown>)) if (!id || id.length > 200 || !['pending', 'used', 'refunded'].includes(state as string)) throw new Error('잘못된 아이템 사용 데이터');
  if (Number(value.focus) + Object.values(value.focusUses as object).filter(state => state === 'pending').length > INVENTORY_LIMIT) throw new Error('아이템 보유 한도 초과');
  for (const [id, r] of Object.entries(value.rewards)) {
    if (!id || id.length > 160 || !record(r) || !['base', 'clean', 'best', 'penalty', 'total'].every(key => integer(r[key]))
      || typeof r.assisted !== 'boolean' || r.total !== Math.max(0, Number(r.base) + Number(r.clean) + Number(r.best) - Number(r.penalty))) throw new Error('잘못된 보상 데이터');
  }
  return structuredClone(value) as unknown as Progress;
}
export function calculateReward(input: RewardInput): Reward {
  if (!input.raceId || input.raceId.length > 160 || !own({ beginner: 1, intermediate: 1, advanced: 1 }, input.difficulty)
    || typeof input.assisted !== 'boolean' || typeof input.improvedExistingBest !== 'boolean'
    || ![input.collisions, input.offTrackExits, input.recoveries, input.penaltyPoints].every(n => integer(n))) throw new Error('Invalid race reward');
  const base = { beginner: 100, intermediate: 150, advanced: 220 }[input.difficulty] * (input.assisted ? .8 : 1);
  const clean = input.collisions + input.offTrackExits + input.recoveries === 0 ? 20 : 0;
  const best = !input.assisted && input.improvedExistingBest ? 20 : 0;
  return { base, clean, best, penalty: input.penaltyPoints, total: Math.max(0, base + clean + best - input.penaltyPoints), assisted: input.assisted };
}
export type ProgressCommand = { kind: 'reward'; input: RewardInput } | { kind: 'craft'; id: string }
  | { kind: 'equip'; id: string } | { kind: 'sell-craft'; id: string } | { kind: 'upgrade'; id: string; upgrade: UpgradeId }
  | { kind: 'focus' } | { kind: 'slots'; count: number } | { kind: 'consume-focus'; id: string } | { kind: 'refund-focus'; id: string } | { kind: 'confirm-focus'; id: string };
export function applyCommand(current: Progress, command: ProgressCommand): Progress {
  const next = validateProgress(current);
  const charge = (cost: number) => { if (next.balance < cost) throw new Error(`${cost - next.balance}P가 부족합니다.`); next.balance -= cost; };
  switch (command.kind) {
    case 'reward': {
      if (own(next.rewards, command.input.raceId)) return next;
      const reward = calculateReward(command.input);
      if (!Number.isSafeInteger(next.balance + reward.total)) throw new Error('포인트 한도를 초과했습니다.');
      next.balance += reward.total; next.rewards[command.input.raceId] = reward; break;
    }
    case 'craft': {
      if (!own(CRAFT_PRICES, command.id)) throw new Error('알 수 없는 기체입니다.');
      if (next.owned.includes(command.id)) throw new Error('이미 보유한 기체입니다.');
      charge(CRAFT_PRICES[command.id]); next.owned.push(command.id); next.upgrades[command.id] = emptyLevels(); break;
    }
    case 'sell-craft': {
      if (command.id === STARTER_ID) throw new Error('기본 기체는 판매할 수 없습니다.');
      if (!next.owned.includes(command.id)) throw new Error('보유한 기체만 판매할 수 있습니다.');
      const refund = craftResaleValue(command.id);
      if (!Number.isSafeInteger(next.balance + refund)) throw new Error('포인트 한도를 초과했습니다.');
      next.balance += refund;
      next.owned = next.owned.filter(id => id !== command.id);
      delete next.upgrades[command.id];
      if (next.equipped === command.id) next.equipped = STARTER_ID;
      break;
    }
    case 'equip':
      if (!next.owned.includes(command.id)) throw new Error('먼저 기체를 구매해주세요.');
      next.equipped = command.id; break;
    case 'upgrade': {
      if (!next.owned.includes(command.id) || !UPGRADES.some(upgrade => upgrade.id === command.upgrade)) throw new Error('잘못된 강화 대상입니다.');
      const level = next.upgrades[command.id][command.upgrade];
      if (level >= 3) throw new Error('최대 단계입니다.');
      charge(UPGRADE_COSTS[level]); next.upgrades[command.id][command.upgrade]++; break;
    }
    case 'focus':
      if (next.focus + Object.values(next.focusUses).filter(state => state === 'pending').length >= INVENTORY_LIMIT) throw new Error('보유 한도에 도달했습니다.');
      charge(FOCUS_PRICE); next.focus++; break;
    case 'slots':
      if (!integer(command.count, 2)) throw new Error('최대 2개를 장착할 수 있습니다.');
      if (command.count > next.focus) throw new Error('아이템 수량이 부족합니다.');
      next.focusSlots = command.count; break;
    case 'consume-focus':
      if (!command.id || command.id.length > 200) throw new Error('Invalid item receipt');
      if (own(next.focusUses, command.id)) return next;
      if (!next.focus) throw new Error('집중 모드가 없습니다.');
      next.focus--; next.focusUses[command.id] = 'pending'; break;
    case 'refund-focus':
      if (next.focusUses[command.id] !== 'pending') return next;
      next.focus++; next.focusUses[command.id] = 'refunded'; break;
    case 'confirm-focus':
      if (next.focusUses[command.id] !== 'pending') return next;
      next.focusUses[command.id] = 'used'; break;
  }
  next.revision++; return validateProgress(next);
}
