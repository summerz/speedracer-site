import { NEAR_MISS_FREEZE, STEP_NAMES, tutorialCopy, tutorialPrompt, type TutorialDevice, type TutorialStepId, type TutorialTarget } from './tutorialCopy';

export type TutorialPhase = 'intro' | 'await' | 'act' | 'demo' | 'freeze' | 'done';
export interface TutorialView { step: TutorialStepId; index: number; total: number; phase?: TutorialPhase | 'show'; checks: { id: string; done: boolean }[]; progress: number; nextIn?: number; frozen?: boolean; inputLocked?: boolean; expectedCheck?: string }
export interface TutorialCoachActions { skip(): void; skipAll(): void; continue(): void }
export interface CoachWorldTarget { x: number; y: number; visible: boolean }
export interface CoachStepResult { id: TutorialStepId; result: 'pending' | 'completed' | 'skipped' }
export interface TutorialCoach {
  render(view: TutorialView | null, label?: string, target?: CoachWorldTarget): void;
  showComplete(steps: CoachStepResult[], onStart: () => void, onAgain: () => void): void;
  hideComplete(): void;
  dispose(): void;
}

const SELECTORS: Record<TutorialTarget, string> = { joystick: '.touch-joystick', boost: '.touch-boost', altitude: '.touch-rise, .touch-descend', 'height-guide': '.height-guide', 'boost-meter': '.boost-readout' };
const ATTR = 'data-coach-target';
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

// In await, narrow the highlighted targets to what the expected check needs.
function awaitTargets(step: TutorialStepId, check: string | undefined, device: TutorialDevice, fallback: TutorialTarget[]): TutorialTarget[] {
  if (!check) return fallback;
  const touch = device === 'touch';
  if (step === 'altitude' || step === 'hazard') return [touch ? 'altitude' : 'height-guide'];
  if (step === 'steer' || step === 'brake') return touch ? ['joystick'] : [];
  if (step === 'boost') return [touch ? 'boost' : 'boost-meter'];
  return fallback;
}

export function createTutorialCoach(container: HTMLElement, actions: TutorialCoachActions | (() => void), onSkipAll?: () => void): TutorialCoach {
  const act: TutorialCoachActions = typeof actions === 'function' ? { skip: actions, skipAll: onSkipAll ?? (() => {}), continue: () => {} } : actions;
  const root = document.createElement('section');
  root.className = 'tutorial-coach'; root.setAttribute('role', 'status'); root.setAttribute('aria-live', 'polite'); root.hidden = true;
  container.appendChild(root);
  let key = ''; let bar: HTMLElement | null = null; let marked: Element[] = [];
  let ring: HTMLElement | null = null; let tag: HTMLElement | null = null;
  let complete: HTMLElement | null = null;
  const clearTargets = (): void => { for (const el of marked) el.removeAttribute(ATTR); marked = []; };
  const onClick = (event: Event): void => {
    const el = event.target as HTMLElement;
    if (el.closest('.coach-skip')) act.skip();
    else if (el.closest('.coach-off')) act.skipAll();
    else if (root.dataset.phase === 'intro' || root.dataset.phase === 'freeze') act.continue();
  };
  root.addEventListener('click', onClick);

  const removeWorld = (): void => { ring?.remove(); tag?.remove(); ring = null; tag = null; };
  const renderWorld = (target: CoachWorldTarget | undefined, freeze: boolean): void => {
    if (!target?.visible) { removeWorld(); return; }
    if (!ring) { ring = document.createElement('div'); ring.className = 'coach-world-ring'; container.appendChild(ring); }
    ring.style.transform = `translate(${target.x}px,${target.y}px)`;
    if (freeze) {
      if (!tag) { tag = document.createElement('div'); tag.className = 'coach-world-tag'; tag.textContent = NEAR_MISS_FREEZE.tag; container.appendChild(tag); }
      tag.style.transform = target.x + 220 > container.clientWidth ? `translate(${target.x - 56}px,${target.y - 10}px) translateX(-100%)` : `translate(${target.x + 56}px,${target.y - 10}px)`;
    } else if (tag) { tag.remove(); tag = null; }
  };

  const hide = (): void => { if (!root.hidden) root.hidden = true; key = ''; bar = null; clearTargets(); removeWorld(); container.classList.remove('is-tutorial-frozen'); };

  const render = (view: TutorialView | null, label = '첫 주행 연습', target?: CoachWorldTarget): void => {
    if (!view || complete) { hide(); return; }
    const device: TutorialDevice = window.matchMedia('(any-pointer: coarse)').matches ? 'touch' : 'keys';
    const copy = tutorialCopy(view.step, device);
    const frozen = !!view.frozen;
    container.classList.toggle('is-tutorial-frozen', frozen);
    let phase: TutorialPhase = !view.phase || view.phase === 'show' ? 'act' : view.phase;
    const prompt = phase === 'await' && view.expectedCheck ? tutorialPrompt(view.step, view.expectedCheck, device) : null;
    if (phase === 'await' && !prompt) phase = 'act';
    const next = typeof view.nextIn === 'number' ? 1 : -1;
    const nextKey = [label, view.step, device, view.index, view.total, phase, view.expectedCheck ?? '', frozen ? 1 : 0, next, view.checks.map((c) => `${c.id}:${c.done ? 1 : 0}`).join(',')].join('|');
    if (nextKey !== key) {
      key = nextKey;
      root.dataset.phase = phase;
      root.classList.toggle('is-await', phase === 'await');
      const tone = phase === 'await' || phase === 'act' ? '해 보기' : phase === 'done' ? '완료' : '안내';
      const eyebrow = `<div class="coach-eyebrow"><span>${tone} ${view.index + 1} / ${view.total} · ${copy.name}</span><span>${esc(label)}</span></div>`;
      const checks = view.checks.map((c) => { const l = esc(copy.checks[c.id] ?? c.id); return c.done ? `<span class="is-done">✓ ${l}</span>` : `<span>○ ${l}</span>`; }).join('');
      const go = `<button type="button" class="coach-go">${device === 'touch' ? '탭해서 계속' : '계속 <kbd>Enter</kbd>'}</button>`;
      const off = '<button type="button" class="coach-off">안내 끄기</button>';
      const chip = frozen ? `<div class="coach-chip">${phase === 'await' ? '입력을 기다리는 중' : '멈춤'}</div>` : '';
      let inner: string;
      if (phase === 'intro') inner = `${eyebrow}<h3>${copy.title}</h3><p>${copy.body}</p><div class="coach-foot">${off}${go}</div>`;
      else if (phase === 'freeze') inner = `${eyebrow}<h3>${NEAR_MISS_FREEZE.title}</h3><p>${NEAR_MISS_FREEZE.body}</p><div class="coach-foot">${off}${go}</div>`;
      else if (phase === 'demo') inner = `${eyebrow}<h3>${copy.title}</h3><p>${copy.body}</p><div class="coach-foot">${off}<span class="coach-auto">자동 주행 중</span></div>`;
      else if (phase === 'await' && prompt) inner = `${eyebrow}<h3>${prompt.title}</h3><div class="coach-prompt">${prompt.prompt} — ${device === 'touch' ? '그러면' : '누르면'} 다시 달려요</div><div class="coach-foot"><div class="coach-checks">${checks}</div><button type="button" class="coach-skip">건너뛰기</button></div>`;
      else inner = `${eyebrow}<h3>${copy.title}</h3><p>${copy.body}</p><div class="coach-checks">${checks}${off}</div><button type="button" class="coach-skip">건너뛰기</button><div class="coach-bar"><i></i></div>${next >= 0 ? '<p class="coach-toast">좋아요 ✓</p>' : ''}`;
      root.innerHTML = chip + inner;
      bar = root.querySelector('.coach-bar i');
      clearTargets();
      if (phase === 'await' || phase === 'act' || phase === 'demo') {
        const targets = phase === 'await' ? awaitTargets(view.step, view.expectedCheck, device, copy.targets) : copy.targets;
        for (const t of targets) for (const el of container.querySelectorAll(SELECTORS[t])) { el.setAttribute(ATTR, ''); marked.push(el); }
      }
    }
    if (bar) bar.style.width = `${Math.max(0, Math.min(1, view.progress)) * 100}%`;
    renderWorld(target, phase === 'freeze');
    if (root.hidden) root.hidden = false;
  };

  const hideComplete = (): void => { complete?.remove(); complete = null; };
  const showComplete = (steps: CoachStepResult[], onStart: () => void, onAgain: () => void): void => {
    hide(); hideComplete();
    const items = steps.map((s) => s.result === 'completed' ? `<li class="is-done">✓ ${STEP_NAMES[s.id]}</li>` : `<li class="is-skipped">– ${STEP_NAMES[s.id]} (건너뜀)</li>`).join('');
    const el = document.createElement('section');
    el.className = 'tutorial-complete'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'tutorial-complete-title');
    el.innerHTML = `<div class="complete-card"><div class="complete-eyebrow">첫 주행 연습 완료</div><h2 id="tutorial-complete-title">준비 끝!</h2><p>이제 실제 첫 코스를 달려 볼까요? 기록과 보상은 여기서부터 쌓여요.</p><ul>${items}</ul><div class="complete-actions"><button type="button" class="primary-action" data-act="start">첫 코스 시작 ↗</button><button type="button" data-act="again">한 번 더 연습</button></div></div>`;
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b?.dataset.act === 'start') onStart(); else if (b?.dataset.act === 'again') onAgain();
    });
    container.appendChild(el); complete = el;
    el.querySelector<HTMLElement>('[data-act="start"]')?.focus();
  };

  const dispose = (): void => { hide(); hideComplete(); root.removeEventListener('click', onClick); root.remove(); };
  return { render, showComplete, hideComplete, dispose };
}
