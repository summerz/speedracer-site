export type AnalyticsScreen = 'hangar' | 'campaign' | 'shop' | 'race';
export type AnalyticsEvent = 'page_view' | 'level_start' | 'level_end' | 'race_quit';
export type AnalyticsParams = Record<string, string | number | boolean>;
export interface AnalyticsTransport {
  send(event: AnalyticsEvent, params: AnalyticsParams): void;
  setAllowed(allowed: boolean): void;
}

/** Consent and availability are checked at send time; no historical events are retained. */
export function createAnalytics(options: {
  enabled: boolean; measurementId: string; version: string; origin: string;
  consent: boolean | null; standalone: boolean;
  transport: (id: string) => AnalyticsTransport;
}) {
  const available = options.enabled && /^G-[A-Z0-9]+$/.test(options.measurementId);
  let consent = options.consent;
  let transport: AnalyticsTransport | undefined;
  let screen: AnalyticsScreen | undefined;
  const send = (event: AnalyticsEvent, params: AnalyticsParams) => {
    if (!available || consent !== true) return;
    try {
      transport ??= options.transport(options.measurementId);
      transport.send(event, { ...params, app_version: options.version, app_mode: options.standalone ? 'installed' : 'browser' });
    } catch { /* Measurement must never interrupt gameplay. */ }
  };
  const page = () => {
    if (screen) send('page_view', { page_title: `Speedracer / ${screen}`, page_location: `${options.origin}/#${screen}`, screen_name: screen });
  };
  return {
    available,
    get consent() { return consent; },
    send,
    screen(next: AnalyticsScreen) { if (screen !== next) { screen = next; page(); } },
    setConsent(allowed: boolean) {
      if (allowed === consent) return;
      consent = allowed;
      try { transport?.setAllowed(allowed); } catch { /* Optional external service. */ }
      if (allowed) page();
    },
  };
}

export interface RaceAnalyticsContext {
  track_id: string; race_mode: string; difficulty: string; ship_id: string;
  control_type: 'touch' | 'desktop';
}
export interface RaceAnalyticsSnapshot {
  id: string; phase: 'ready' | 'countdown' | 'running' | 'paused' | 'finished';
  seconds: number; laps: number; collisions: number; exits: number; obstacles: number;
  success: boolean; disqualified: boolean; rank: number; stars: number;
}

/** One attempt spans countdown, pauses and completion. A reset closes the preceding attempt. */
export function createRaceAnalytics(send: (event: AnalyticsEvent, params: AnalyticsParams) => void) {
  let active: { context: RaceAnalyticsContext; state: RaceAnalyticsSnapshot; ended: boolean } | undefined;
  let attempts = 0;
  const metrics = (state: RaceAnalyticsSnapshot): AnalyticsParams => ({
    elapsed_seconds: Math.round(state.seconds * 100) / 100,
    completed_laps: state.laps, collisions: state.collisions, off_track_exits: state.exits,
    obstacles_passed: state.obstacles,
  });
  const safeSend: typeof send = (event, params) => { try { send(event, params); } catch { /* Never affect driving. */ } };
  const quit = (reason: 'restart' | 'navigation' | 'page_exit' | 'render_error') => {
    if (!active || active.ended) return;
    active.ended = true;
    safeSend('race_quit', { ...active.context, level_name: active.context.track_id, ...metrics(active.state), quit_reason: reason });
  };
  return {
    observe(state: RaceAnalyticsSnapshot, context: RaceAnalyticsContext) {
      if (state.phase === 'ready' || !state.id) return;
      if (active?.state.id !== state.id) {
        quit('restart');
        active = { context: { ...context }, state: { ...state }, ended: false };
        safeSend('level_start', { ...context, level_name: context.track_id, is_retry: attempts++ > 0 });
      }
      active.state = { ...state };
      if (state.phase === 'finished' && !active.ended) {
        active.ended = true;
        safeSend('level_end', { ...active.context, level_name: active.context.track_id, ...metrics(state),
          success: state.success, result: state.disqualified ? 'time_limit' : state.success ? 'passed' : 'rank_cutoff',
          finish_rank: state.rank, stars: state.stars });
      }
    },
    quit,
  };
}
