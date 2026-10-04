export interface TouchDrivingInput { throttle: boolean; brake: boolean; steer: number; boost: boolean }
type HoldAction = 'left' | 'right' | 'brake' | 'boost';

/** Owns concurrent fingers, capture cancellation and the mobile auto-throttle policy. */
export function createTouchControls(container: HTMLElement, actions: {
  lift(direction: number): void; interact(): void; releaseBoost(): void;
}) {
  const media = window.matchMedia('(any-pointer: coarse)');
  const element = document.createElement('nav');
  element.className = 'touch-controls'; element.setAttribute('aria-label', '터치 주행 조작');
  element.innerHTML = `
    <div class="touch-pad touch-steering"><span class="touch-caption">자동 가속 · 감속은 길게</span>
      <div class="touch-steer-row"><button type="button" data-hold="left" aria-label="왼쪽 조향">←</button><button type="button" data-hold="right" aria-label="오른쪽 조향">→</button></div>
      <button type="button" data-hold="brake" class="touch-brake">감속</button>
    </div>
    <div class="touch-pad touch-flight"><div class="touch-height-row"><button type="button" data-lift="-1" aria-label="한 단계 하강">↓</button><button type="button" data-lift="1" aria-label="한 단계 상승">↑</button></div>
      <button type="button" data-hold="boost" class="touch-boost">BOOST <span>길게 누르기</span></button>
    </div>`;
  container.append(element);
  const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')];
  const held = new Map<number, { button: HTMLButtonElement; action: HoldAction }>();
  const events = new AbortController();
  const listen = { signal: events.signal };
  let running = false;
  const has = (action: HoldAction) => [...held.values()].some(value => value.action === action);
  const refreshButtons = () => buttons.forEach(button => button.classList.toggle('is-held', [...held.values()].some(value => value.button === button)));
  const release = (pointerId: number) => {
    const boosting = has('boost'); held.delete(pointerId); refreshButtons();
    if (boosting && !has('boost')) actions.releaseBoost();
  };
  const reset = () => {
    const captures = [...held.entries()]; held.clear(); refreshButtons();
    captures.forEach(([id, { button }]) => { if (button.hasPointerCapture(id)) button.releasePointerCapture(id); });
  };
  const refresh = () => {
    element.hidden = !media.matches || !running;
    container.classList.toggle('has-touch-controls', media.matches);
    buttons.forEach(button => button.disabled = !running);
    if (!media.matches) reset();
  };
  buttons.forEach(button => {
    button.addEventListener('pointerdown', event => {
      if (!running || !media.matches || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault(); actions.interact();
      const lift = button.dataset.lift;
      if (lift) { actions.lift(Number(lift)); return; }
      const action = button.dataset.hold as HoldAction;
      button.setPointerCapture(event.pointerId);
      held.set(event.pointerId, { button, action }); refreshButtons();
    }, listen);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      button.addEventListener(name, event => release(event.pointerId), listen);
    }
    button.addEventListener('contextmenu', event => event.preventDefault(), listen);
    // Keyboard activation of the tap buttons remains usable with an attached keyboard.
    button.addEventListener('click', event => {
      if (event.detail === 0 && running && button.dataset.lift) actions.lift(Number(button.dataset.lift));
    }, listen);
  });
  media.addEventListener('change', refresh, listen); refresh();
  return {
    read(): TouchDrivingInput {
      return { throttle: media.matches && running, brake: has('brake'), steer: Number(has('right')) - Number(has('left')), boost: has('boost') };
    },
    setRunning(value: boolean) { running = value; if (!running) reset(); refresh(); },
    reset,
    dispose() { reset(); events.abort(); element.remove(); container.classList.remove('has-touch-controls'); },
  };
}
