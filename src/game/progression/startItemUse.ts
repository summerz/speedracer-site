import type { RivalItemId } from './catalog.js';
import type { RaceMode } from '../driving/createRaceSession.js';
import type { ProgressStore } from './progressStore.js';

/** Reserve stock before the countdown; never refund an effect already activated. */
export async function reserveStartItems(options: {
  store: Pick<ProgressStore, 'command'>; items: readonly RivalItemId[]; mode: RaceMode; receipt: string;
  valid(): boolean; start(): void; activate(item: RivalItemId): boolean;
}): Promise<boolean> {
  const reserved: { item: RivalItemId; id: string; activated: boolean }[] = [];
  const refundUnused = async () => {
    for (const entry of reserved) if (!entry.activated)
      await options.store.command({ kind: 'refund-rival', id: entry.id });
  };
  try {
    for (const [index, item] of options.items.entries()) {
      const id = `${options.receipt}:${index}`;
      await options.store.command({ kind: 'consume-rival', item, id, mode: options.mode });
      reserved.push({ item, id, activated: false });
    }
    if (!options.valid()) { await refundUnused(); return false; }
    options.start();
    // Activate synchronously before awaiting confirmations, so the first frame is enhanced.
    for (const entry of reserved) entry.activated = options.activate(entry.item);
    await refundUnused();
    for (const entry of reserved) if (entry.activated)
      await options.store.command({ kind: 'confirm-rival', id: entry.id });
    return reserved.some(entry => entry.activated);
  } catch (error) {
    await refundUnused();
    throw error;
  }
}
