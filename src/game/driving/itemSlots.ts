import { isAutomaticItem } from '../progression/catalog.js';
import { itemLoadout } from '../progression/itemLoadout.js';
export { ITEM_SLOT_KEYS } from '../progression/itemLoadout.js';
export const itemSlotIndex = (code: string): number | null => code === 'KeyQ' ? 0 : code === 'KeyE' ? 1 : null;

/** Same order as the campaign loadout. Consumed/automatic slots never shift their neighbours. */
export function createItemSlots(focus: number, rivals: Parameters<typeof itemLoadout>[1]) {
  const slots = itemLoadout(focus, rivals).map(slot => ({ ...slot, remaining: slot.count }));
  return {
    slots,
    manual(index: number) {
      const slot = slots[index];
      return slot && slot.remaining > 0 && !isAutomaticItem(slot.item) ? slot.item : null;
    },
    consume(index: number) { const slot = slots[index]; if (slot) slot.remaining = Math.max(0, slot.remaining - 1); },
  };
}
