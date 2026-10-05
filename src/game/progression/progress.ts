import { initialCampaign, validateCampaign, completeCampaign } from './campaign.js';
import type { CampaignProgress, CampaignOutcome } from './campaign.js';
import { trackDefinition } from '../track/trackCatalog.js';
import { CRAFT_PRICES, craftResaleValue, emptyLevels, FOCUS_PRICE, INVENTORY_LIMIT, STARTER_ID, UPGRADES, UPGRADE_COSTS, RIVAL_ITEMS, isRivalItem } from './catalog.js';
import type { UpgradeId, UpgradeLevels, RivalItemId } from './catalog.js';
import type { DifficultyId } from '../track/difficulty.js';
import { CLEAN_HALF_LAP_POINTS, RECORD_BONUS_POINTS, OBSTACLE_PASS_POINTS } from '../driving/raceScoring.js';

export interface RewardInput {
  raceId: string; difficulty: DifficultyId; collisions: number; offTrackExits: number; recoveries: number;
  penaltyPoints: number; obstaclesPassed?: number; cleanHalfLaps: number; improvedExistingBest: boolean; assisted: boolean;
}
export interface Reward { base: number; clean: number; best: number; penalty: number; total: number; assisted: boolean; bonus?: number; obstacles?: number }
export interface Progress {
  version: 1; revision: number; balance: number; owned: string[]; equipped: string;
  upgrades: Record<string, UpgradeLevels>; focus: number; focusSlots: number;
  rewards: Record<string, Reward>;
  campaign: CampaignProgress;
  focusUses: Record<string, 'pending' | 'used' | 'refunded'>;
  rivalInventory: Record<RivalItemId, number>;
  rivalSlots: RivalItemId[];
  rivalUses: Record<string, { item: RivalItemId; state: 'pending' | 'used' | 'refunded' }>;
}
export const initialProgress = (): Progress => ({ version: 1, revision: 0, balance: 0, owned: [STARTER_ID], equipped: STARTER_ID,
  upgrades: { [STARTER_ID]: emptyLevels() }, focus: 0, focusSlots: 0, rewards: {}, focusUses: {}, campaign: initialCampaign(),
  rivalInventory: { 'time-stop': 0, interference: 0 }, rivalSlots: [], rivalUses: {} });
const integer = (n: unknown, max = Number.MAX_SAFE_INTEGER): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= max;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (object: object, key: string) => Object.hasOwn(object, key);
export function validateProgress(value: unknown): Progress {
  if (record(value) && value.campaign === undefined) value = { ...value, campaign: initialCampaign() };
  if (record(value) && value.focusUses === undefined) value = { ...value, focusUses: {} };
  if (record(value) && value.rivalInventory === undefined && value.rivalSlots === undefined && value.rivalUses === undefined)
    value = { ...value, rivalInventory: { 'time-stop': 0, interference: 0 }, rivalSlots: [], rivalUses: {} };
  // v0.12 profiles have four upgrades. Add only the new stabilizer, preserving
  // all purchased levels; incomplete or unknown upgrade records still fail below.
  if (record(value) && record(value.upgrades)) {
    value = { ...value, upgrades: Object.fromEntries(Object.entries(value.upgrades).map(([id, levels]) => [id,
      record(levels) && !own(levels, 'stabilizer') && Object.keys(levels).length === UPGRADES.length - 1
        && UPGRADES.filter(upgrade => upgrade.id !== 'stabilizer').every(upgrade => own(levels, upgrade.id))
        ? { ...levels, stabilizer: 0 } : levels])) };
  }
  if (!record(value) || value.version !== 1 || !integer(value.revision) || !integer(value.balance)
    || !Array.isArray(value.owned) || !value.owned.length || new Set(value.owned).size !== value.owned.length
    || !value.owned.every(id => typeof id === 'string' && own(CRAFT_PRICES, id)) || !value.owned.includes(STARTER_ID)
    || !value.owned.includes(value.equipped) || !record(value.upgrades) || !record(value.rewards)
    || !record(value.focusUses) || !integer(value.focus, INVENTORY_LIMIT) || !integer(value.focusSlots, 2)) throw new Error('진행 저장 데이터가 올바르지 않습니다.');
  if (!record(value.rivalInventory) || Object.keys(value.rivalInventory).length !== RIVAL_ITEMS.length
    || !RIVAL_ITEMS.every(item => integer((value.rivalInventory as Record<string, unknown>)[item.id], INVENTORY_LIMIT))
    || !Array.isArray(value.rivalSlots) || !value.rivalSlots.every(isRivalItem) || value.rivalSlots.length + Number(value.focusSlots) > 2
    || !record(value.rivalUses)) throw new Error('잘못된 상대 아이템 데이터');
  for (const [id, use] of Object.entries(value.rivalUses))
    if (!id || id.length > 200 || !record(use) || !isRivalItem(use.item) || !['pending', 'used', 'refunded'].includes(use.state as string)) throw new Error('잘못된 아이템 사용 데이터');
  for (const item of RIVAL_ITEMS) {
    const pending = Object.values(value.rivalUses).filter(use => (use as { item: string; state: string }).item === item.id && (use as { state: string }).state === 'pending').length;
    if (Number(value.rivalInventory[item.id]) + pending > INVENTORY_LIMIT) throw new Error('아이템 보유 한도 초과');
  }
  if (Object.keys(value.upgrades).length !== value.owned.length) throw new Error('잘못된 강화 데이터');
  for (const id of value.owned) {
    const levels = value.upgrades[id];
    if (!record(levels) || Object.keys(levels).length !== UPGRADES.length || !UPGRADES.every(upgrade => integer(levels[upgrade.id], 3))) throw new Error('잘못된 강화 데이터');
  }
  for (const [id, state] of Object.entries(value.focusUses as Record<string, unknown>)) if (!id || id.length > 200 || !['pending', 'used', 'refunded'].includes(state as string)) throw new Error('잘못된 아이템 사용 데이터');
  if (Number(value.focus) + Object.values(value.focusUses as object).filter(state => state === 'pending').length > INVENTORY_LIMIT) throw new Error('아이템 보유 한도 초과');
  for (const [id, r] of Object.entries(value.rewards)) {
    if (!id || id.length > 160 || !record(r) || !['base', 'clean', 'best', 'penalty', 'total'].every(key => integer(r[key]))
      || typeof r.assisted !== 'boolean' || r.total !== Math.max(0, Number(r.base) + Number(r.clean) + Number(r.best) + Number(r.bonus ?? 0) + Number(r.obstacles ?? 0) - Number(r.penalty))) throw new Error('잘못된 보상 데이터');
    if (r.obstacles !== undefined && !integer(r.obstacles)) throw new Error('잘못된 장애물 보상');
    if (r.bonus !== undefined && !integer(r.bonus)) throw new Error('잘못된 첫 클리어 보상');
  }
  value.campaign = validateCampaign(value.campaign);
  return structuredClone(value) as unknown as Progress;
}
export function calculateReward(input: RewardInput): Reward {
  if (!input.raceId || input.raceId.length > 160 || !own({ beginner: 1, intermediate: 1, advanced: 1 }, input.difficulty)
    || typeof input.assisted !== 'boolean' || typeof input.improvedExistingBest !== 'boolean'
    || ![input.collisions, input.offTrackExits, input.recoveries, input.penaltyPoints].every(n => integer(n))
    || !integer(input.obstaclesPassed ?? 0) || !integer(input.cleanHalfLaps, 20)) throw new Error('Invalid race reward');
  const base = { beginner: 100, intermediate: 150, advanced: 220 }[input.difficulty] * (input.assisted ? .8 : 1);
  const clean = input.cleanHalfLaps * CLEAN_HALF_LAP_POINTS;
  const best = !input.assisted && input.improvedExistingBest ? RECORD_BONUS_POINTS : 0;
  const obstacles = (input.obstaclesPassed ?? 0) * OBSTACLE_PASS_POINTS;
  return { base, clean, best, obstacles, penalty: input.penaltyPoints, total: Math.max(0, base + clean + best + obstacles - input.penaltyPoints), assisted: input.assisted };
}
export type ProgressCommand = { kind: 'campaign-select'; mode: CampaignOutcome['mode']; trackId: string }
  | { kind: 'campaign-result'; input: RewardInput; outcome: CampaignOutcome } | { kind: 'reward'; input: RewardInput } | { kind: 'craft'; id: string }
  | { kind: 'equip'; id: string } | { kind: 'sell-craft'; id: string } | { kind: 'upgrade'; id: string; upgrade: UpgradeId }
  | { kind: 'focus' } | { kind: 'slots'; count: number } | { kind: 'consume-focus'; id: string } | { kind: 'refund-focus'; id: string } | { kind: 'confirm-focus'; id: string }
  | { kind: 'rival-buy'; item: RivalItemId; mode: CampaignOutcome['mode'] }
  | { kind: 'rival-slots'; slots: RivalItemId[]; mode: CampaignOutcome['mode'] }
  | { kind: 'consume-rival'; item: RivalItemId; id: string; mode: CampaignOutcome['mode'] }
  | { kind: 'refund-rival' | 'confirm-rival'; id: string };
export function applyCommand(current: Progress, command: ProgressCommand): Progress {
  const next = validateProgress(current);
  const charge = (cost: number) => { if (next.balance < cost) throw new Error(`${cost - next.balance}P가 부족합니다.`); next.balance -= cost; };
  switch (command.kind) {
    case 'campaign-select': {
      if (!trackDefinition(command.trackId) || !['time-attack', 'competition'].includes(command.mode)) throw new Error('알 수 없는 트랙입니다.');
      next.campaign.last = { mode: command.mode, trackId: command.trackId };
      if (!next.campaign.knownTracks.includes(command.trackId)) next.campaign.knownTracks.push(command.trackId); break;
    }
    case 'campaign-result': {
      if (own(next.rewards, command.input.raceId)) return next;
      if (command.input.assisted !== command.outcome.assisted) throw new Error('잘못된 보조 모드');
      const completion = completeCampaign(next.campaign, command.outcome);
      const calculated = calculateReward(command.input);
      const reward = command.outcome.disqualified ? { base: 0, clean: 0, best: 0, penalty: 0, total: 0, assisted: command.input.assisted } : calculated;
      reward.bonus = completion.bonus; reward.total = Math.max(0, reward.base + reward.clean + reward.best + reward.bonus + (reward.obstacles ?? 0) - reward.penalty);
      if (!Number.isSafeInteger(next.balance + reward.total)) throw new Error('포인트 한도를 초과했습니다.');
      next.balance += reward.total; next.rewards[command.input.raceId] = reward; break;
    }
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
      if (!integer(command.count, 2) || command.count + next.rivalSlots.length > 2) throw new Error('최대 2개를 장착할 수 있습니다.');
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
    case 'rival-buy': {
      if (command.mode !== 'competition' || !isRivalItem(command.item)) throw new Error('AI 경주 전용 아이템입니다.');
      const item = RIVAL_ITEMS.find(item => item.id === command.item)!;
      const pending = Object.values(next.rivalUses).filter(use => use.item === command.item && use.state === 'pending').length;
      if (next.rivalInventory[command.item] + pending >= INVENTORY_LIMIT) throw new Error('보유 한도에 도달했습니다.');
      charge(item.price); next.rivalInventory[command.item]++; break;
    }
    case 'rival-slots': {
      if (command.mode !== 'competition' || !Array.isArray(command.slots) || !command.slots.every(isRivalItem)) throw new Error('AI 경주 전용 아이템입니다.');
      if (command.slots.length + next.focusSlots > 2) throw new Error('최대 2개를 장착할 수 있습니다.');
      for (const item of RIVAL_ITEMS) if (command.slots.filter(id => id === item.id).length > next.rivalInventory[item.id]) throw new Error('아이템 수량이 부족합니다.');
      next.rivalSlots = [...command.slots]; break;
    }
    case 'consume-rival': {
      if (command.mode !== 'competition' || !isRivalItem(command.item)) throw new Error('AI 경주 전용 아이템입니다.');
      if (!command.id || command.id.length > 200) throw new Error('Invalid item receipt');
      if (own(next.rivalUses, command.id)) {
        if (next.rivalUses[command.id].item !== command.item) throw new Error('잘못된 아이템 영수증');
        return next;
      }
      if (!next.rivalInventory[command.item]) throw new Error('아이템 수량이 부족합니다.');
      next.rivalInventory[command.item]--; next.rivalUses[command.id] = { item: command.item, state: 'pending' }; break;
    }
    case 'refund-rival': case 'confirm-rival': {
      const use = next.rivalUses[command.id];
      if (use?.state !== 'pending') return next;
      if (command.kind === 'refund-rival') next.rivalInventory[use.item]++;
      use.state = command.kind === 'refund-rival' ? 'refunded' : 'used'; break;
    }
  }
  next.revision++; return validateProgress(next);
}
