import { applyCommand, initialProgress, validateProgress, previewRelock } from './progress.js';
import type { Progress, ProgressCommand } from './progress.js';
import { campaignRecordKeys, type CampaignRecordStorage } from './campaignRecordCleanup.js';

export interface ProgressRepository {
  read(): Promise<unknown>;
  transact(change: (current: unknown) => Progress): Promise<Progress>;
  close(): void;
}
/** One IDB read/write transaction owns the entire profile. Browser tabs serialize automatically. */
export function indexedProgressRepository(factory: IDBFactory): ProgressRepository {
  let opening: Promise<IDBDatabase> | undefined;
  const open = () => opening ??= new Promise((resolve, reject) => {
    const request = factory.open('speedracer-progress', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('profile');
    request.onerror = () => { opening = undefined; reject(new Error('진행 저장소에 연결하지 못했습니다.')); };
    request.onblocked = () => { opening = undefined; reject(new Error('다른 창의 저장소 연결을 닫고 다시 시도해주세요.')); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined; }; resolve(request.result); };
  });
  return {
    async read() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('profile', 'readonly');
        const request = transaction.objectStore('profile').get('current');
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(new Error('진행 데이터를 읽지 못했습니다.'));
      });
    },
    async transact(change) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('profile', 'readwrite');
        const store = transaction.objectStore('profile');
        const request = store.get('current');
        let result: Progress; let failure: unknown;
        request.onsuccess = () => {
          try { result = change(request.result); store.put(result, 'current'); }
          catch (error) { failure = error; transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(failure ?? new Error('저장하지 못했습니다. 저장 공간을 확인하고 다시 시도해주세요.'));
      });
    },
    close() { void opening?.then(db => db.close()).catch(() => {}); opening = undefined; },
  };
}
function browserRecordStorage(): CampaignRecordStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; }
  catch { return undefined; }
}
export function createProgressStore(repository: ProgressRepository, recordStorage = browserRecordStorage()) {
  let state = initialProgress(); let issue = ''; let closed = false;
  const listeners = new Set<() => void>();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('speedracer-progress') : undefined;
  const publish = () => { for (const listener of listeners) listener(); };
  const refresh = async () => {
    try { const value = await repository.read(); const loaded = value === undefined ? initialProgress() : validateProgress(value); if (loaded.revision >= state.revision) state = loaded; issue = ''; }
    catch (error) { issue = error instanceof Error ? error.message : '진행 저장을 사용할 수 없습니다.'; }
    publish();
  };
  if (channel) channel.onmessage = () => { void refresh(); };
  return {
    snapshot: () => structuredClone(state),
    previewRelock: () => previewRelock(state, recordStorage),
    get issue() { return issue; },
    refresh,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async command(command: ProgressCommand) {
      try {
        let removeKeys: string[] = [];
        const saved = await repository.transact(value => {
          const current = value === undefined ? initialProgress() : validateProgress(value);
          if (command.kind === 'campaign-unlock-all' && !command.on && recordStorage)
            removeKeys = campaignRecordKeys(previewRelock(current, recordStorage), recordStorage);
          return applyCommand(current, command);
        });
        if (saved.revision >= state.revision) state = saved;
        if (!closed) channel?.postMessage('changed');
        // Never discard caches if the profile transaction failed. All variants
        // are collected before removing keys, since localStorage indices shift.
        try { if (recordStorage) for (const key of removeKeys) recordStorage.removeItem(key); }
        catch (error) { throw new Error(`해금 설정은 저장됐지만 주행 기록 정리를 완료하지 못했습니다. 다시 잠금을 시도해주세요. ${error instanceof Error ? error.message : ''}`); }
        issue = ''; publish(); return structuredClone(saved);
      } catch (error) { issue = error instanceof Error ? error.message : '저장하지 못했습니다.'; publish(); throw error; }
    },
    close() { closed = true; channel?.close(); repository.close(); listeners.clear(); },
  };
}
export type ProgressStore = ReturnType<typeof createProgressStore>;
