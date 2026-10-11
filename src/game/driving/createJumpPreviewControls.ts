import { JUMP_CAMERA_SHOTS, type JumpCameraShot } from './jumpPresentation';

const LABELS: Record<JumpCameraShot, string> = { orbit: '회전', bird: '버드아이', low: '로우 앵글', side: '측면' };

/** Local feature-test controls only; playback runs the real driving model at the authored jump. */
export function createJumpPreviewControls(parent: HTMLElement, play: (shots: readonly JumpCameraShot[]) => void, stop: () => void) {
  const panel = document.createElement('section');
  panel.className = 'jump-preview-controls';
  panel.setAttribute('aria-label', '점프 연출 테스트');
  panel.innerHTML = `<header><strong>점프 연출 테스트</strong><button type="button" data-stop>정지</button></header>
      <p role="status">점프 100m 전부터 자동 주행 · 기록 저장 없음</p>
    <button type="button" data-all>네 연출 연속 보기</button>
    <div>${JUMP_CAMERA_SHOTS.map(shot => `<button type="button" data-shot="${shot}" aria-pressed="false">${LABELS[shot]}</button>`).join('')}</div>
    <button type="button" data-reset>코스 처음부터</button>`;
  const style = document.createElement('style');
  style.textContent = `.jump-preview-controls{position:absolute;right:12px;bottom:170px;z-index:8;width:min(360px,calc(100% - 24px));padding:12px;border:1px solid #79ded4;border-radius:12px;background:#061521ed;color:#e0faf6;pointer-events:auto;font:12px system-ui}
    .jump-preview-controls header{display:flex;justify-content:space-between;align-items:center;gap:8px}.jump-preview-controls p{margin:8px 0;color:#b6d5d4}
    .jump-preview-controls button{min-height:36px;padding:6px 10px;border:1px solid #568783;border-radius:6px;background:#102e3b;color:#e0faf6;cursor:pointer;font:inherit}
    .jump-preview-controls [data-all]{width:100%;margin-bottom:6px;background:#14554c}.jump-preview-controls>div{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.jump-preview-controls [aria-pressed=true]{background:#81e3d3;color:#071724}.jump-preview-controls [data-reset]{margin-top:8px;font-size:11px}
    .jump-preview-playing #race-countdown,.jump-preview-playing #race-fork3{display:none!important}
    @media(max-width:600px){.jump-preview-controls{bottom:180px;padding:8px;width:min(320px,calc(100% - 24px))}}`;
  panel.append(style); parent.append(panel);
  const status = panel.querySelector<HTMLElement>('[role=status]')!;
  const events = new AbortController();
  panel.addEventListener('pointerdown', event => event.stopPropagation(), { signal: events.signal });
  panel.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    event.stopPropagation();
    if (button.hasAttribute('data-all')) play(JUMP_CAMERA_SHOTS);
    else if (button.dataset.shot) play([button.dataset.shot as JumpCameraShot]);
    else if (button.hasAttribute('data-stop')) stop();
    else if (button.hasAttribute('data-reset')) window.location.reload();
    button.blur();
  }, { signal: events.signal });
  return {
    update(shot: JumpCameraShot | null, index = 0, total = 0, done = false) {
      parent.classList.toggle('jump-preview-playing', shot !== null);
      status.textContent = shot ? `${index + 1}/${total} · ${LABELS[shot]} · 자동 주행`
        : done ? '연속 보기 완료 · 원하는 연출을 다시 눌러 보세요' : '점프 100m 전부터 자동 주행 · 기록 저장 없음';
      panel.querySelectorAll<HTMLButtonElement>('[data-shot]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.shot === shot)));
    },
    dispose() { events.abort(); parent.classList.remove('jump-preview-playing'); panel.remove(); },
  };
}
