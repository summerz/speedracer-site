import { createTouchInput } from './touchInput';
export type { TouchDrivingInput } from './touchInput';

/** Pointer capture plus window-level termination prevents controls staying held. */
export function createTouchControls(container: HTMLElement, actions: {
  lift(direction: number): void; interact(): void; releaseBoost(): void;
}) {
  const media = window.matchMedia('(any-pointer: coarse)');
  const element = document.createElement('nav');
  element.className = 'touch-controls'; element.setAttribute('aria-label', '터치 주행 조작');
  element.innerHTML = `
    <div class="touch-steering"><span class="touch-caption">자동 가속</span>
      <button type="button" class="touch-joystick" aria-label="조향 조이스틱: 좌우 이동, 아래로 당겨 감속, 대각선 동시 조작">
        <span class="stick-cross" aria-hidden="true"></span><span class="stick-label stick-up">가속</span>
        <span class="stick-label stick-left">‹</span><span class="stick-label stick-right">›</span>
        <span class="stick-label stick-down">감속</span><span class="stick-knob" aria-hidden="true"></span>
      </button>
    </div>
    <div class="touch-flight" aria-label="고도와 부스트">
      <button type="button" class="touch-rise" data-lift="1" aria-label="고도 한 단계 상승">↑</button>
      <button type="button" class="touch-descend" data-lift="-1" aria-label="고도 한 단계 하강">↓</button>
      <button type="button" class="touch-boost" aria-label="부스트: 길게 누르기"><span>BOOST</span><small>HOLD</small></button>
    </div>`;
  container.append(element);
  const joystick = element.querySelector<HTMLButtonElement>('.touch-joystick')!;
  const knob = element.querySelector<HTMLElement>('.stick-knob')!;
  const boost = element.querySelector<HTMLButtonElement>('.touch-boost')!;
  const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')];
  const input = createTouchInput();
  const captures = new Map<number, HTMLButtonElement>();
  const events = new AbortController();
  const listen = { signal: events.signal };
  let running = false;
  const paint = () => {
    const { x, y, brake } = input.position;
    knob.style.transform = `translate(${x * joystick.clientWidth * .3}px, ${y * joystick.clientHeight * .3}px)`;
    joystick.classList.toggle('is-held', input.stickPointer !== undefined);
    joystick.classList.toggle('is-braking', brake);
    boost.classList.toggle('is-held', input.read(true).boost);
  };
  const release = (id: number) => {
    const button = captures.get(id);
    captures.delete(id);
    const stoppedBoost = input.release(id);
    if (button?.hasPointerCapture(id)) button.releasePointerCapture(id);
    paint();
    if (stoppedBoost) actions.releaseBoost();
  };
  const reset = () => {
    const boosting = input.read(true).boost;
    const previous = [...captures]; captures.clear(); input.reset(); paint();
    for (const [id, button] of previous) if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
    if (boosting) actions.releaseBoost();
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== input.stickPointer) return;
    if (event.buttons === 0) { release(event.pointerId); return; }
    const rect = joystick.getBoundingClientRect();
    input.moveStick(event.pointerId, event.clientX - rect.left - rect.width / 2,
      event.clientY - rect.top - rect.height / 2, rect.width * .3);
    paint();
  };
  for (const button of buttons) {
    button.addEventListener('pointerdown', event => {
      if (!running || !media.matches || event.button !== 0) return;
      event.preventDefault(); actions.interact();
      if (button.dataset.lift) { actions.lift(Number(button.dataset.lift)); return; }
      if (button === joystick && !input.pressStick(event.pointerId)) return;
      if (button === boost) input.pressBoost(event.pointerId);
      captures.set(event.pointerId, button);
      button.setPointerCapture(event.pointerId);
      if (button === joystick) move(event); else paint();
    }, listen);
    button.addEventListener('lostpointercapture', event => release(event.pointerId), listen);
    button.addEventListener('contextmenu', event => event.preventDefault(), listen);
    button.addEventListener('click', event => {
      if (event.detail === 0 && running && button.dataset.lift) actions.lift(Number(button.dataset.lift));
    }, listen);
  }
  // Observe termination outside the originating element, including multi-touch.
  window.addEventListener('pointerup', event => release(event.pointerId), { ...listen, capture: true });
  window.addEventListener('pointercancel', event => release(event.pointerId), { ...listen, capture: true });
  window.addEventListener('pointermove', move, listen);
  window.addEventListener('blur', reset, listen);
  window.addEventListener('pagehide', reset, listen);
  window.addEventListener('resize', reset, listen);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); }, listen);
  const refresh = () => {
    element.hidden = !media.matches || !running;
    container.classList.toggle('has-touch-controls', media.matches);
    buttons.forEach(button => { button.disabled = !running; });
    if (!media.matches) reset();
  };
  media.addEventListener('change', refresh, listen); refresh();
  return {
    read: () => input.read(media.matches && running),
    setRunning(value: boolean) { running = value; if (!running) reset(); refresh(); },
    reset,
    dispose() { reset(); events.abort(); element.remove(); container.classList.remove('has-touch-controls'); },
  };
}
