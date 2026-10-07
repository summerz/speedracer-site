import { createAnalytics } from './analytics';
import type { AnalyticsTransport } from './analytics';
import { APP_VERSION } from './createAppShell';

const CONSENT_KEY = 'speedracer.analytics-consent.v1';
type TagWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
const tagWindow = window as TagWindow;
const measurementId = (import.meta.env.VITE_GA_MEASUREMENT_ID ?? '').trim();
const readConsent = (): boolean | null => {
  try { const saved = localStorage.getItem(CONSENT_KEY); return saved === 'granted' ? true : saved === 'denied' ? false : null; }
  catch { return null; }
};
const clearAnalyticsCookies = () => {
  for (const entry of document.cookie.split(';')) {
    const name = entry.trim().split('=')[0];
    if (name !== '_ga' && !name.startsWith('_ga_')) continue;
    const domains = ['', location.hostname, '.' + location.hostname, '.summerz.net'];
    for (const domain of domains) document.cookie = `${name}=; Max-Age=0; Path=/;${domain ? ` Domain=${domain};` : ''} SameSite=Lax; Secure`;
  }
};
const transport = (id: string): AnalyticsTransport => {
  const disabledKey = `ga-disable-${id}`;
  const disable = (value: boolean) => { Reflect.set(window, disabledKey, value); };
  disable(false);
  tagWindow.dataLayer ??= [];
  tagWindow.gtag ??= function () { tagWindow.dataLayer!.push(arguments); };
  const tag = tagWindow.gtag;
  tag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  tag('js', new Date());
  let referrer = '';
  try { if (document.referrer) referrer = new URL(document.referrer).origin; } catch { /* No referrer. */ }
  tag('config', id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
    page_location: `${location.origin}/`, page_referrer: referrer, cookie_flags: 'SameSite=Lax;Secure' });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  let failed = false;
  script.onerror = () => { failed = true; disable(true); };
  document.head.append(script);
  return {
    send(event, params) { if (!failed) tag('event', event, { ...params, send_to: id }); },
    setAllowed(allowed) {
      disable(!allowed || failed);
      // Disabling this property blocks measurement; changing consent clears its stored identifiers.
      tag('consent', 'update', { analytics_storage: allowed ? 'granted' : 'denied' });
      if (!allowed) clearAnalyticsCookies();
    },
  };
};

export const gameAnalytics = createAnalytics({
  enabled: import.meta.env.PROD && location.hostname === 'speedracer.summerz.net',
  measurementId, version: APP_VERSION, origin: location.origin, consent: readConsent(),
  standalone: matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone,
  transport,
});

export function setAnalyticsConsent(allowed: boolean) {
  try { localStorage.setItem(CONSENT_KEY, allowed ? 'granted' : 'denied'); } catch { /* Choice applies for this visit. */ }
  gameAnalytics.setConsent(allowed);
}
