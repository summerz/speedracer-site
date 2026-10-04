/** Only the tab explicitly applying an update reloads. Other tabs keep running. */
export async function applyWaitingUpdate(
  registration: ServiceWorkerRegistration,
  serviceWorker: ServiceWorkerContainer,
  reload: () => void = () => location.reload(),
  timeoutMs = 15000,
) {
  const worker = registration.waiting;
  if (!worker) { await registration.update(); return false; }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); serviceWorker.removeEventListener('controllerchange', changed); };
    const changed = () => {
      if (serviceWorker.controller !== worker) return;
      cleanup(); resolve();
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Update activation timed out')); }, timeoutMs);
    serviceWorker.addEventListener('controllerchange', changed);
    try { worker.postMessage({ type: 'APPLY_UPDATE' }); changed(); }
    catch (error) { cleanup(); reject(error); }
  });
  reload();
  return true;
}

export function waitingVersion(worker: ServiceWorker): Promise<string | null> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = (version: unknown) => {
      clearTimeout(timer); channel.port1.close(); channel.port2.close();
      resolve(typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version : null);
    };
    const timer = setTimeout(() => finish(null), 1500);
    channel.port1.onmessage = event => finish(event.data?.version);
    try { worker.postMessage({ type: 'GET_UPDATE_INFO' }, [channel.port2]); }
    catch { finish(null); }
  });
}
