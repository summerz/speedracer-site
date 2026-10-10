import { raceChallenge } from './game/track/raceChallenge';
import { sfxPreference } from './game/audio/sfxPreference';
import { soundtrack } from './game/audio/soundtrack';
import { DRONE_CATALOG } from './game/drone/droneCatalog';
import { createProgressStore, indexedProgressRepository } from './game/progression/progressStore';
import { upgradedConfiguration } from './game/progression/catalog';
import { trackDefinition } from './game/track/trackCatalog';
import { campaignStatus } from './game/progression/campaign';
import { mountMenuNavigation } from './platform/menuNavigation';
import { gameAnalytics } from './platform/gameAnalytics';
import { mountAnalyticsPreferences } from './platform/analyticsPreferences';
import { menuShortcut } from './platform/menuShortcuts';

export function mountApp(root: HTMLDivElement): () => void {
  const disposeNavigation = mountMenuNavigation(root);
  const disposeAnalyticsPreferences = mountAnalyticsPreferences(root);
  const repository = (() => {
    try { return indexedProgressRepository(window.indexedDB); }
    catch { return { read: async () => { throw new Error('진행 저장을 사용할 수 없습니다. 주행은 가능합니다.'); }, transact: async () => { throw new Error('진행 저장을 사용할 수 없습니다.'); }, close() {} }; }
  })();
  const store = createProgressStore(repository);
  soundtrack.start();
  const activateAudio = () => { if (!(import.meta.env.DEV && location.hash.split('?')[0] === '#sound-lab')) soundtrack.activate(); };
  const visibility = () => document.hidden ? soundtrack.suspend() : activateAudio();
  const toggleMusic = () => {
    // The race keeps its own music toggle state; go through its button so both stay in sync.
    const raceMusic = root.querySelector<HTMLButtonElement>('#race-music');
    if (raceMusic) { if (!raceMusic.disabled) raceMusic.click(); return; }
    soundtrack.setEnabled(!soundtrack.enabled); refreshMusicButton();
  };
  const toggleSfx = () => {
    const raceSound = root.querySelector<HTMLButtonElement>('#race-sound');
    if (raceSound) { if (!raceSound.disabled) raceSound.click(); return; }
    sfxPreference.set(!sfxPreference.enabled); refreshMusicButton();
  };
  const musicToggle = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-music-toggle], [data-sfx-toggle]') : null;
    if (target) (target.hasAttribute('data-sfx-toggle') ? toggleSfx : toggleMusic)();
  };
  const shortcut = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.defaultPrevented) return;
    if ((event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) || document.querySelector('dialog[open]')) return;
    const name = location.hash.slice(1).split('?')[0];
    const group = root.querySelector<HTMLElement>('.course-challenges');
    const action = menuShortcut(event.code, { screen: ['campaign', 'shop', 'sound-lab', 'drive'].includes(name) ? name : 'hangar', dev: import.meta.env.DEV, difficultyVisible: !!group && !group.closest('[hidden]') && group.getClientRects().length > 0 });
    if (!action) return;
    event.preventDefault();
    if (action.kind === 'music') toggleMusic();
    else if (action.kind === 'sfx') toggleSfx();
    else if (action.kind === 'difficulty') {
      const buttons = [...root.querySelectorAll<HTMLElement>('[data-challenge]')];
      buttons[(buttons.findIndex(button => button.getAttribute('aria-pressed') === 'true') + 1) % buttons.length]?.click();
    } else if (action.kind === 'go') location.hash = action.hash;
    else root.querySelector<HTMLElement>(`[data-mode="${action.mode}"]`)?.click();
  };
  const refreshMusicButton = () => {
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-music-toggle]')) {
      button.setAttribute('aria-pressed', String(soundtrack.enabled));
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-sfx-toggle]')) button.setAttribute('aria-pressed', String(sfxPreference.enabled));
  };
  document.addEventListener('pointerdown', activateAudio);
  document.addEventListener('keydown', activateAudio);
  document.addEventListener('visibilitychange', visibility);
  root.addEventListener('click', musicToggle);
  document.addEventListener('keydown', shortcut);
  let disposeScreen = () => {}; let renderId = 0; let disposed = false;
  const developmentGrant = import.meta.env.DEV
    ? Promise.all([
      import('./devProgress').then(module => module.grantLocalPlaytestPoints(repository)).catch(() => {}),
      import('./devAudio').then(module => module.initializeDevAudio()).catch(error => console.warn('개발 오디오 저장을 불러오지 못했습니다.', error)),
    ])
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
    if (import.meta.env.DEV && screen === 'sound-lab') soundtrack.suspend();
    else soundtrack.setScene(screen === 'drive' ? 'ready' : 'menu');
    const profile = store.snapshot();
    const entry = DRONE_CATALOG.find(craft => craft.configuration.id === profile.equipped)!;
    const selected = { ...entry, configuration: upgradedConfiguration(profile.equipped, profile.upgrades[profile.equipped]) };
    if (screen === 'drive' && params.has('track') && (!track || (params.get('test') !== '1' && campaignStatus(profile.campaign, mode, track) === 'locked'))) { location.hash = 'campaign'; return; }
    const mount = import.meta.env.DEV && screen === 'sound-lab'
      ? () => import('./devAudioApp').then(({ mountDevAudio }) => () => mountDevAudio(root, profile.balance, params.get('view') === 'library' ? 'library' : 'assignments'))
      : screen === 'drive'
      ? () => import('./raceApp').then(({ mountRace }) => () => mountRace(root, () => { location.hash = track ? `campaign?track=${track.id}&mode=${mode}&challenge=${challenge}` : 'campaign'; }, selected.configuration, store, () => { location.hash = 'shop'; }, track ? { track, mode, challenge, test: params.get('test') === '1' } : undefined))
      : screen === 'campaign' ? () => import('./campaignApp').then(({ mountCampaign }) => () => mountCampaign(root, store, params.has('mode') ? { mode, trackId: params.get('track') ?? undefined, challenge } : undefined))
      : screen === 'shop' ? () => import('./shopApp').then(({ mountShop }) => () => mountShop(root, store, () => { location.hash = ''; }))
      : () => import('./hangarApp').then(({ mountHangar }) => () => mountHangar(root, selected, () => {}, () => { location.hash = 'campaign'; }, store));
    try {
      const mountScreen = await mount();
      if (disposed || id !== renderId) return;
      disposeScreen = mountScreen();
      if (screen !== 'sound-lab') gameAnalytics.screen(screen === 'drive' ? 'race' : screen === 'campaign' ? 'campaign' : screen === 'shop' ? 'shop' : 'hangar');
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
    document.removeEventListener('visibilitychange', visibility); root.removeEventListener('click', musicToggle); document.removeEventListener('keydown', shortcut);
    disposeNavigation(); disposeAnalyticsPreferences(); disposeScreen(); store.close(); soundtrack.dispose(); root.replaceChildren();
  };
}
