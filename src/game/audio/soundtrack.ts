import musicPlaylist from '../../assets/audio/music-playlist.json' with { type: 'json' };
export interface MusicTrack { file: string; title: string }
export type MusicScene = 'menu' | 'ready' | 'countdown' | 'running' | 'paused' | 'finished';
export const SOUNDTRACKS: readonly MusicTrack[] = musicPlaylist;

type Deck = {
  audio: HTMLAudioElement; song: number; request: number; unlocked?: boolean;
  gain?: GainNode; source?: MediaElementAudioSourceNode; seek?: number;
};
type SoundtrackOptions = {
  baseUrl?: string; contextFactory?: () => AudioContext;
  mediaFactory?: () => HTMLAudioElement; fadeSeconds?: number;
  random?: () => number;
  tracks?: readonly MusicTrack[];
  resolveUrl?: (file: string, original: string) => string;
};

/** App-owned streaming transport survives screen changes without decoding full songs into RAM. */
export function createSoundtrack({ baseUrl = '/', contextFactory = () => new AudioContext(), mediaFactory = () => new Audio(), fadeSeconds = .6, random = Math.random, resolveUrl, tracks = SOUNDTRACKS }: SoundtrackOptions = {}) {
  if (!tracks.length) throw new Error('A lobby music track is required');
  let raceQueue: number[] = []; let lastRace = 0;
  const nextRaceSong = () => {
    if (!raceQueue.length) {
      raceQueue = Array.from({ length: tracks.length - 1 }, (_, i) => i + 1);
      for (let i = raceQueue.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [raceQueue[i], raceQueue[j]] = [raceQueue[j], raceQueue[i]];
      }
      // Keep every song in the next bag, but avoid repeating across its boundary.
      if (raceQueue.length > 1 && raceQueue[0] === lastRace) {
        const j = 1 + Math.floor(random() * (raceQueue.length - 1));
        [raceQueue[0], raceQueue[j]] = [raceQueue[j], raceQueue[0]];
      }
    }
    return raceQueue[0] ?? 0;
  };
  const decks: Deck[] = [0, nextRaceSong()].map(song => ({ audio: mediaFactory(), song, request: 0 }));
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let context: AudioContext | undefined; let master: GainNode | undefined;
  let current: Deck | undefined; let pending: Deck | undefined;
  let wanted = 0; let lobbyPosition = 0;
  let scene: MusicScene = 'menu'; let enabled = true; let disposed = false; let hidden = false;
  let ducking = 1; let generation = 0;
  const level = () => ducking * (scene === 'running' || scene === 'countdown' ? .55 : scene === 'paused' ? .22 : .4);
  const setLevel = () => { if (context && master) master.gain.setTargetAtTime(enabled && !hidden ? level() : 0, context.currentTime, .025); };
  const remember = (deck: Deck) => { if (deck.song === 0 && !deck.audio.ended) lobbyPosition = deck.audio.currentTime; };
  const prepare = (deck: Deck, song: number) => {
    deck.request++; deck.audio.pause(); deck.song = song;
    if (context && deck.gain) {
      deck.gain.gain.cancelScheduledValues(context.currentTime);
      deck.gain.gain.setValueAtTime(0, context.currentTime);
    }
    deck.seek = song === 0 ? lobbyPosition : 0;
    deck.audio.preload = 'auto'; deck.audio.loop = song === 0;
    const file = tracks[song].file;
    deck.audio.src = resolveUrl?.(file, `${baseUrl}music/ost/${file}`) ?? `${baseUrl}music/ost/${file}`;
    deck.audio.load();
  };
  const ramp = (deck: Deck, value: number) => {
    if (!context || !deck.gain) return;
    const param = deck.gain.gain; const now = context.currentTime;
    param.cancelScheduledValues(now); param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + fadeSeconds);
  };
  const preloadNext = () => {
    if (!current || pending || disposed) return;
    const idle = decks.find(deck => deck !== current)!;
    const nextRace = nextRaceSong();
    if (idle.song !== nextRace || idle.audio.ended) prepare(idle, nextRace);
  };
  const seek = (deck: Deck) => {
    if (deck.seek === undefined || deck.audio.readyState < 1) return;
    try { deck.audio.currentTime = Math.min(deck.seek, Math.max(0, deck.audio.duration - 1)); deck.seek = undefined; } catch { /* Retry when metadata arrives. */ }
  };
  const begin = () => {
    if (!context || disposed || !enabled || hidden || pending || (tracks.length === 1 && !['menu', 'ready'].includes(scene))) return;
    const deck = current?.song === wanted && !current.audio.ended ? current : decks.find(item => item !== current)!;
    if (deck.song !== wanted || deck.audio.ended) prepare(deck, wanted);
    seek(deck); pending = deck;
    const token = generation; const request = ++deck.request;
    try {
      // Call play inside the gesture, rather than awaiting AudioContext.resume().
      void deck.audio.play().then(() => {
        deck.unlocked = true;
        if (disposed || token !== generation || request !== deck.request || hidden || !enabled) {
          if (request === deck.request && deck !== current) deck.audio.pause();
          return;
        }
        pending = undefined;
        const previous = current; current = deck; ramp(deck, 1);
        if (previous && previous !== deck) {
          ramp(previous, 0);
          const timer = setTimeout(() => {
            timers.delete(timer);
            if (disposed || previous === current || previous === pending) return;
            remember(previous); previous.audio.pause(); preloadNext();
          }, fadeSeconds * 1000 + 30);
          timers.add(timer);
        } else preloadNext();
      }).catch(() => {
        if (token === generation && request === deck.request) pending = undefined;
        // Retain the previous song; retry the desired file on the next gesture.
      });
    } catch { pending = undefined; }
  };
  const select = (song: number) => {
    if (wanted === song && (pending || (current?.song === song && !current.audio.paused))) return;
    generation++; pending = undefined; wanted = song; begin();
  };
  const advanceRace = () => {
    const song = nextRaceSong(); raceQueue.shift(); lastRace = song; select(song);
  };
  const events = decks.map(deck => {
    const metadata = () => seek(deck);
    const boundary = () => {
      if (disposed || hidden || !enabled || pending || current !== deck || wanted !== deck.song || deck.song === 0) return;
      if (deck.audio.ended || (Number.isFinite(deck.audio.duration) && deck.audio.duration - deck.audio.currentTime <= fadeSeconds)) advanceRace();
    };
    deck.audio.addEventListener('loadedmetadata', metadata);
    deck.audio.addEventListener('timeupdate', boundary);
    deck.audio.addEventListener('ended', boundary);
    return { metadata, boundary };
  });
  const preload = () => { if (!disposed) decks.forEach(deck => { if (!deck.audio.src) prepare(deck, deck.song); }); };
  const activate = () => {
    if (disposed || !enabled) return;
    hidden = false;
    try {
      preload();
      if (!context) {
        context = contextFactory(); master = context.createGain(); master.gain.value = level(); master.connect(context.destination);
        for (const deck of decks) {
          deck.gain = context.createGain(); deck.gain.gain.value = 0;
          deck.source = context.createMediaElementSource(deck.audio); deck.source.connect(deck.gain); deck.gain.connect(master);
        }
      }
      void context.resume().catch(() => {}); setLevel(); begin();
      // Unlock both elements on iOS; the idle deck is inaudible and immediately paused.
      for (const deck of decks) if (!deck.unlocked && deck !== current && deck !== pending) {
        const request = ++deck.request;
        void deck.audio.play().then(() => {
          deck.unlocked = true;
          if (request === deck.request && deck !== current && deck !== pending) { deck.audio.pause(); if (deck.song !== 0) deck.seek = 0; }
        }).catch(() => {});
      }
    } catch { /* Music is optional and never blocks driving. */ }
  };
  const stop = () => {
    generation++; pending = undefined;
    decks.forEach(deck => { deck.request++; deck.audio.pause(); });
  };
  return {
    activate, preload,
    setScene(next: MusicScene) {
      const enteringRace = (next === 'countdown' || next === 'running') && !['countdown', 'running', 'paused'].includes(scene);
      scene = next;
      if (enteringRace && tracks.length === 1) stop();
      else if (enteringRace) advanceRace(); else if (next === 'menu' || next === 'ready') select(0);
      setLevel();
    },
    setEnabled(value: boolean) { enabled = value; if (!value) stop(); else activate(); setLevel(); },
    setDucking(value: number) { ducking = Math.max(.1, Math.min(1, value)); setLevel(); },
    get enabled() { return enabled; },
    snapshot() { return { song: tracks[current?.song ?? wanted].title, scene, racing: wanted !== 0, enabled, loaded: (current?.audio.readyState ?? 0) >= 2, state: context?.state ?? 'locked', position: current?.audio.currentTime ?? 0 }; },
    suspend() { hidden = true; stop(); setLevel(); if (context) void context.suspend().catch(() => {}); },
    dispose() {
      disposed = true; stop(); timers.forEach(clearTimeout); timers.clear();
      decks.forEach((deck, i) => {
        deck.audio.removeEventListener('loadedmetadata', events[i].metadata);
        deck.audio.removeEventListener('timeupdate', events[i].boundary);
        deck.audio.removeEventListener('ended', events[i].boundary);
        deck.source?.disconnect(); deck.gain?.disconnect(); deck.audio.removeAttribute('src'); deck.audio.load();
      });
      master?.disconnect(); if (context) void context.close().catch(() => {});
    },
  };
}

let player: ReturnType<typeof createSoundtrack> | undefined;
let playlist: readonly MusicTrack[] = SOUNDTRACKS;
let assetResolver: SoundtrackOptions['resolveUrl'];
export const soundtrack = {
  start() {
    if (player) return;
    player = createSoundtrack({ baseUrl: import.meta.env.BASE_URL, resolveUrl: assetResolver, tracks: playlist });
    try { player.setEnabled(localStorage.getItem('speedracer-music') !== 'off'); } catch { /* Optional preference. */ }
    player.preload();
  },
  activate() { player?.activate(); },
  setScene(scene: MusicScene) { player?.setScene(scene); },
  setEnabled(enabled: boolean) { player?.setEnabled(enabled); try { localStorage.setItem('speedracer-music', enabled ? 'on' : 'off'); } catch { /* Optional preference. */ } },
  get enabled() { return player?.enabled ?? true; },
  setDucking(value: number) { player?.setDucking(value); },
  suspend() { player?.suspend(); },
  setAssetResolver(resolve: SoundtrackOptions['resolveUrl'], tracks: readonly MusicTrack[] = SOUNDTRACKS) {
    assetResolver = resolve; playlist = tracks;
    if (player) { player.dispose(); player = undefined; soundtrack.start(); }
  },
  dispose() { player?.dispose(); player = undefined; },
};
