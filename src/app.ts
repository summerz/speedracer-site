import { raceChallenge } from './game/track/raceChallenge';
import { soundtrack } from './game/audio/soundtrack';
import { DRONE_CATALOG } from './game/drone/droneCatalog';
import { createProgressStore, indexedProgressRepository } from './game/progression/progressStore';
import { upgradedConfiguration } from './game/progression/catalog';
import { trackDefinition } from './game/track/trackCatalog';
import { campaignStatus } from './game/progression/campaign';
import { mountMenuNavigation } from './platform/menuNavigation';

export function mountApp(root: HTMLDivElement): () => void {
  const disposeNavigation = mountMenuNavigation(root);
  const repository = (() => {
    try { return indexedProgressRepository(window.indexedDB); }
    catch { return { read: async () => { throw new Error('진행 저장을 사용할 수 없습니다. 주행은 가능합니다.'); }, transact: async () => { throw new Error('진행 저장을 사용할 수 없습니다.'); }, close() {} }; }
  })();
  const store = createProgressStore(repository);
  soundtrack.start();
  const activateAudio = () => soundtrack.activate();
  const visibility = () => document.hidden ? soundtrack.suspend() : soundtrack.activate();
  const musicToggle = (event: Event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-music-toggle]')) return;
    soundtrack.setEnabled(!soundtrack.enabled); refreshMusicButton();
  };
  const refreshMusicButton = () => {
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-music-toggle]')) {
      button.setAttribute('aria-pressed', String(soundtrack.enabled)); button.textContent = soundtrack.enabled ? '음악 켜짐' : '음악 꺼짐';
    }
  };
  document.addEventListener('pointerdown', activateAudio);
  document.addEventListener('keydown', activateAudio);
  document.addEventListener('visibilitychange', visibility);
  root.addEventListener('click', musicToggle);
  let disposeScreen = () => {}; let renderId = 0; let disposed = false;
  const developmentGrant = import.meta.env.DEV
    ? import('./devProgress').then(module => module.grantLocalPlaytestPoints(repository)).catch(() => {})
    : Promise.resolve();
  const render = async () => {
    const id = ++renderId;
    disposeScreen(); disposeScreen = () => {};
    root.innerHTML = '<div class="screen-loading progress-warning" role="status">화면을 준비하고 있습니다…</div>';
    await developmentGrant;
    await store.refresh();
    if (disposed || id !== renderId) return;
    const [screen, query = ''] = location.hash.slice(1).split('?');
    const params = new URLSearchParams(query);
    const track = trackDefinition(params.get('track') ?? '');
    const challenge = raceChallenge(params.get('challenge'));
    const mode = params.get('mode') === 'competition' ? 'competition' : 'time-attack';
    soundtrack.setScene(screen === 'drive' ? 'ready' : 'menu');
    const profile = store.snapshot();
    const entry = DRONE_CATALOG.find(craft => craft.configuration.id === profile.equipped)!;
    const selected = { ...entry, configuration: upgradedConfiguration(profile.equipped, profile.upgrades[profile.equipped]) };
    if (screen === 'drive' && params.has('track') && (!track || campaignStatus(profile.campaign, mode, track) === 'locked')) { location.hash = 'campaign'; return; }
    const mount = screen === 'drive'
      ? () => import('./raceApp').then(({ mountRace }) => () => mountRace(root, () => { location.hash = track ? `campaign?track=${track.id}&mode=${mode}&challenge=${challenge}` : 'campaign'; }, selected.configuration, store, () => { location.hash = 'shop'; }, track ? { track, mode, challenge } : undefined))
      : screen === 'campaign' ? () => import('./campaignApp').then(({ mountCampaign }) => () => mountCampaign(root, store, params.has('mode') ? { mode, trackId: params.get('track') ?? undefined, challenge } : undefined))
      : screen === 'shop' ? () => import('./shopApp').then(({ mountShop }) => () => mountShop(root, store, () => { location.hash = ''; }))
      : () => import('./hangarApp').then(({ mountHangar }) => () => mountHangar(root, selected, () => {}, () => { location.hash = 'campaign'; }, store));
    try {
      const mountScreen = await mount();
      if (disposed || id !== renderId) return;
      disposeScreen = mountScreen();
    } catch (error) {
      if (disposed || id !== renderId) return;
      console.error('화면 로딩 실패:', error);
      root.innerHTML = '<div class="screen-loading progress-warning" role="alert"><p>화면을 불러오지 못했습니다. 연결을 확인하고 다시 시도해주세요.</p><button class="primary-action" type="button" id="screen-retry">다시 시도</button></div>';
      // Failed module imports remain cached in the document; reload to retry the request.
      root.querySelector('#screen-retry')!.addEventListener('click', () => { location.reload(); }, { once: true });
    }
    refreshMusicButton();
  };
  const onHash = () => { void render(); };
  window.addEventListener('hashchange', onHash);
  void render();
  return () => {
    disposed = true; renderId++;
    window.removeEventListener('hashchange', onHash);
    document.removeEventListener('pointerdown', activateAudio); document.removeEventListener('keydown', activateAudio);
    document.removeEventListener('visibilitychange', visibility); root.removeEventListener('click', musicToggle);
    disposeNavigation(); disposeScreen(); store.close(); soundtrack.dispose(); root.replaceChildren();
  };
}
