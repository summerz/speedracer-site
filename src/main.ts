import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './style.css';
import { mountApp } from './app';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('앱 진입점을 찾을 수 없습니다.');

const dispose = mountApp(root);
if (import.meta.hot) import.meta.hot.dispose(dispose);
