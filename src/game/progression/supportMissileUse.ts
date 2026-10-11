import type { ProgressStore } from './progressStore.js';

/** Persist the reservation before launching; recheck the live race after asynchronous storage. */
export async function reserveSupportMissile(options: {
  store: Pick<ProgressStore, 'command'>; receipt: string; requestId: number;
  valid(): boolean; launch(requestId: number): boolean; reject(requestId: number): void;
}): Promise<boolean> {
  const { store, receipt, requestId } = options;
  try {
    await store.command({ kind: 'consume-rival', item: 'support-missile', id: receipt, mode: 'competition' });
    if (!options.valid() || !options.launch(requestId)) {
      await store.command({ kind: 'refund-rival', id: receipt });
      options.reject(requestId); return false;
    }
    // After a real launch, a failed confirmation must never refund a spent shot.
    await store.command({ kind: 'confirm-rival', id: receipt });
    return true;
  } catch (error) { options.reject(requestId); throw error; }
}
