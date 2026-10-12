import type { RivalItemId } from './catalog.js';

export type RaceItemId = 'focus' | RivalItemId;
export const ITEM_STACK_LIMIT = 5;
export const ITEM_SLOT_KEYS = ['Q', 'E'] as const;
/** Legacy focus-first order; copies form two stable type slots. */
export function itemLoadout(focus: number, rivals: readonly RivalItemId[]) {
  const slots: { item: RaceItemId; count: number }[] = [];
  if (focus) slots.push({ item: 'focus', count: focus });
  for (const item of rivals) {
    const existing = slots.find(slot => slot.item === item);
    if (existing) existing.count++;
    else slots.push({ item, count: 1 });
  }
  return slots;
}
export function validItemLoadout(focus: number, rivals: readonly RivalItemId[]): boolean {
  const slots = itemLoadout(focus, rivals);
  return Number.isInteger(focus) && focus >= 0 && focus <= ITEM_STACK_LIMIT
    && slots.length <= ITEM_SLOT_KEYS.length && slots.every(slot => slot.count <= ITEM_STACK_LIMIT);
}
