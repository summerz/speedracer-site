export type DevAudioKind = 'sfx' | 'music';
export interface DevAudioOverride {
  id: string; libraryId?: string; name?: string; blob?: Blob; level?: number; updated: number; disabled?: boolean;
}
export interface DevAudioLibraryFile {
  id: string; title: string; kind: DevAudioKind; name: string; blob: Blob;
  source: 'upload' | 'agent'; duration: number; added: number;
}

/** Separate database: audio experiments never write campaign or purchase data. */
export function createDevAudioStore(factory: IDBFactory) {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('speedracer-dev-audio', 2);
    request.onupgradeneeded = () => {
      for (const name of ['overrides', 'library']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('다른 개발 탭의 사운드 관리를 닫고 다시 시도해주세요.'));
  });
  const write = async (names: string[], action: (transaction: IDBTransaction) => void) => {
    const db = await database;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(names, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('사운드를 저장하지 못했습니다.'));
      action(transaction);
    });
  };
  const read = async <T>(name: string): Promise<T[]> => {
    const db = await database;
    return new Promise((resolve, reject) => {
      const request = db.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  };
  return {
    read: () => read<DevAudioOverride>('overrides'),
    readLibrary: () => read<DevAudioLibraryFile>('library'),
    save: (record: DevAudioOverride) => write(['overrides'], tx => tx.objectStore('overrides').put(record)),
    saveLibrary: (record: DevAudioLibraryFile) => write(['library'], tx => tx.objectStore('library').put(record)),
    remove: (id: string) => write(['overrides'], tx => tx.objectStore('overrides').delete(id)),
    clear: () => write(['overrides'], tx => tx.objectStore('overrides').clear()),
    deleteLibrary: (id: string, references: DevAudioOverride[]) => write(['overrides', 'library'], tx => {
      tx.objectStore('library').delete(id);
      for (const record of references) tx.objectStore('overrides').put(record);
    }),
  };
}
