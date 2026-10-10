import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './style.css';
import { createAppShell } from './platform/createAppShell';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('앱 진입점을 찾을 수 없습니다.');
const loading = document.querySelector<HTMLElement>('#app-loading');
const disposeShell = createAppShell(root);
let disposeApp = () => {};
try {
  const { mountApp } = await import('./app');
  disposeApp = mountApp(root);
  requestAnimationFrame(() => loading?.remove());
} catch (error) {
  console.error('앱 시작 실패:', error);
  document.querySelector('#loading-message')!.textContent = '불러오지 못했습니다. 연결을 확인하고 다시 시도해주세요.';
  document.querySelector<HTMLElement>('#loading-retry')!.hidden = false;
}
if (import.meta.hot) import.meta.hot.dispose(() => { disposeApp(); disposeShell(); });
