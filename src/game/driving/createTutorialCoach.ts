import { tutorialCopy, type TutorialDevice, type TutorialStepId, type TutorialTarget } from './tutorialCopy';

export interface TutorialView { step: TutorialStepId; index: number; total: number; checks: { id: string; done: boolean }[]; progress: number; nextIn?: number }

const SELECTORS: Record<TutorialTarget, string> = { joystick: '.touch-joystick', boost: '.touch-boost', altitude: '.touch-rise, .touch-descend', 'height-guide': '.height-guide', 'boost-meter': '.boost-readout' };
const ATTR = 'data-coach-target';
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export function createTutorialCoach(container: HTMLElement, onSkip: () => void, onSkipAll: () => void): { render(view: TutorialView | null): void; dispose(): void } {
  const root = document.createElement('section');
  root.className = 'tutorial-coach'; root.setAttribute('role', 'status'); root.setAttribute('aria-live', 'polite'); root.hidden = true;
  container.appendChild(root);
  let key = ''; let bar: HTMLElement | null = null; let marked: Element[] = [];
  const clearTargets = (): void => { for (const el of marked) el.removeAttribute(ATTR); marked = []; };
  const onClick = (event: Event): void => { const el = event.target as HTMLElement; if (el.closest('.coach-skip')) onSkip(); else if (el.closest('.coach-off')) onSkipAll(); };
  root.addEventListener('click', onClick);

  const render = (view: TutorialView | null): void => {
    if (!view) { if (!root.hidden) root.hidden = true; key = ''; bar = null; clearTargets(); return; }
    const device: TutorialDevice = window.matchMedia('(any-pointer: coarse)').matches ? 'touch' : 'keys';
    const copy = tutorialCopy(view.step, device);
    const next = typeof view.nextIn === 'number' ? 1 : -1;
    const nextKey = [view.step, device, view.index, view.total, next, view.checks.map((c) => `${c.id}:${c.done ? 1 : 0}`).join(',')].join('|');
    if (nextKey !== key) {
      key = nextKey;
      const checks = view.checks.map((c) => { const label = esc(copy.checks[c.id] ?? c.id); return c.done ? `<span class="is-done">✓ ${label}</span>` : `<span>○ ${label}</span>`; }).join('');
      root.innerHTML = `<div class="coach-eyebrow"><span>연습 ${view.index + 1} / ${view.total} · ${copy.name}</span><span>첫 코스</span></div><h3>${copy.title}</h3><p>${copy.body}</p><div class="coach-checks">${checks}<button type="button" class="coach-off">안내 끄기</button></div><button type="button" class="coach-skip">건너뛰기</button><div class="coach-bar"><i></i></div>${next >= 0 ? `<p class="coach-toast">좋아요 ✓</p>` : ''}`;
      bar = root.querySelector('.coach-bar i');
      clearTargets();
      for (const target of copy.targets) for (const el of container.querySelectorAll(SELECTORS[target])) { el.setAttribute(ATTR, ''); marked.push(el); }
    }
    if (bar) bar.style.width = `${Math.max(0, Math.min(1, view.progress)) * 100}%`;
    if (root.hidden) root.hidden = false;
  };
  const dispose = (): void => { clearTargets(); root.removeEventListener('click', onClick); root.remove(); };
  return { render, dispose };
}
