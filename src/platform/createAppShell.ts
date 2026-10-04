import { applyWaitingUpdate, waitingVersion } from './appUpdate';
import './appShell.css';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION;

/** App-level install/update UI survives navigation, but only appears in menus. */
export function createAppShell(root: HTMLElement) {
  const events = new AbortController();
  const listen = { signal: events.signal };
  let registration: ServiceWorkerRegistration | undefined;
  let installPrompt: InstallPrompt | undefined;
  let installed = false;
  let phase = 'hangar';
  let applying = false;
  let checking: Promise<void> | undefined;
  let updateVersion: string | null = null;
  let status = '';
  let stopped = false;
  let notifiedWorker: ServiceWorker | undefined;
  const tools = document.createElement('div');
  tools.className = 'app-shell-tools';
  tools.innerHTML = `<span class="app-version">v${APP_VERSION}</span><button type="button" data-install>앱 설치</button><button type="button" data-update hidden>업데이트</button><span class="app-update-status" role="status" aria-live="polite"></span>`;
  const install = tools.querySelector<HTMLButtonElement>('[data-install]')!;
  const update = tools.querySelector<HTMLButtonElement>('[data-update]')!;
  const message = tools.querySelector<HTMLElement>('.app-update-status')!;
  const dialog = document.createElement('dialog');
  dialog.className = 'install-dialog';
  dialog.innerHTML = `<h2>Speedracer 설치</h2><p>iPhone / iPad: Safari의 공유 메뉴에서 <strong>홈 화면에 추가</strong>를 선택하세요.</p><p>Android / 데스크톱: 브라우저 메뉴의 <strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택하세요.</p><form method="dialog"><button type="submit">닫기</button></form>`;
  document.body.append(dialog);
  const standalone = window.matchMedia('(display-mode: standalone)');
  const paint = () => {
    const slot = root.querySelector<HTMLElement>('[data-app-tools]');
    if (slot && tools.parentElement !== slot) slot.append(tools);
    install.hidden = installed || standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const waiting = Boolean(registration?.waiting);
    update.hidden = !waiting;
    update.textContent = applying ? '업데이트 적용 중…' : `${updateVersion ? 'v' + updateVersion : '새 버전'} 업데이트 ↻`;
    update.disabled = applying || !import.meta.env.PROD || !registration;
    update.classList.toggle('update-ready', waiting);
    message.textContent = status;
    root.querySelector('#race-pause')?.classList.toggle('has-update', waiting);
  };
  // Each screen mounts its descendants synchronously when replacing root children.
  const observer = new MutationObserver(paint);
  observer.observe(root, { childList: true });
  paint();
  const announce = async () => {
    const worker = registration?.waiting;
    if (worker && worker !== notifiedWorker) {
      notifiedWorker = worker;
      const version = await waitingVersion(worker);
      if (stopped || registration?.waiting !== worker) return;
      updateVersion = version;
    }
    if (!stopped) paint();
  };
  const check = async () => {
    if (!registration || document.hidden || applying) return;
    if (checking) return checking;
    checking = registration.update().then(() => { status = registration?.installing ? '새 버전을 준비하고 있습니다.' : registration?.waiting ? '새 버전이 준비됐습니다.' : ''; })
      .catch(() => { status = '연결 후 다시 확인해주세요.'; })
      .finally(() => { checking = undefined; void announce(); });
    return checking;
  };
  install.addEventListener('click', async () => {
    if (!installPrompt) { dialog.showModal(); return; }
    const prompt = installPrompt; installPrompt = undefined;
    try { await prompt.prompt(); await prompt.userChoice; } catch { dialog.showModal(); }
    paint();
  }, listen);
  update.addEventListener('click', async () => {
    if (!registration || applying) return;
    if (!registration.waiting) { void announce(); return; }
    // Pause releases keys, all fingers and haptics before requesting worker activation.
    window.dispatchEvent(new Event('speedracer:pause-request'));
    if (phase === 'running') { status = '주행을 멈춘 후 적용해주세요.'; paint(); return; }
    applying = true; status = '새 버전 적용 후 다시 시작합니다.'; paint();
    try { await applyWaitingUpdate(registration, navigator.serviceWorker); }
    catch { status = '적용하지 못했습니다. 연결을 확인하고 다시 시도해주세요.'; }
    finally { applying = false; if (!stopped) paint(); }
  }, listen);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event as InstallPrompt; paint(); }, listen);
  window.addEventListener('appinstalled', () => { installed = true; installPrompt = undefined; paint(); }, listen);
  standalone.addEventListener('change', paint, listen);
  window.addEventListener('speedracer:phase', event => { phase = (event as CustomEvent<string>).detail; }, listen);
  const watchInstalling = () => {
    registration?.installing?.addEventListener('statechange', () => {
      if (registration?.waiting) status = '새 버전이 준비됐습니다. 적용하면 주행은 다시 시작합니다.';
      void announce();
    }, listen);
  };
  if (import.meta.env.PROD && isSecureContext && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(value => {
      if (stopped) return;
      registration = value;
      registration.addEventListener('updatefound', watchInstalling, listen);
      watchInstalling(); void announce(); void check();
    }).catch(() => { status = '온라인으로 실행 중 · 오프라인 준비는 나중에 다시 시도합니다.'; paint(); });
  }
  window.addEventListener('online', () => { void check(); }, listen);
  window.addEventListener('focus', () => { void check(); }, listen);
  window.addEventListener('pageshow', () => { void check(); }, listen);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); }, listen);
  const timer = setInterval(() => { void check(); }, 15 * 60 * 1000);
  return () => { stopped = true; events.abort(); observer.disconnect(); clearInterval(timer); tools.remove(); dialog.remove(); };
}
