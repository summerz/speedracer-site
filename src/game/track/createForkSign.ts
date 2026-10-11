import * as THREE from 'three';
import { forkRouteCues, forkCountdownText, type ForkCue, type ForkChoice, type ForkRoadHeight } from './forkCue.js';
import { LANE_HUES } from './createForkLanes.js';
import { defaultBranchRoute, type TrackFork } from './trackBranches.js';
import type { Track } from './createTrack.js';

const ARROWS: Record<ForkChoice, string> = { left: '←', center: '↑', right: '→', lower: '↓', upper: '↑' };
const HEIGHT_STEPS: Record<ForkRoadHeight, number> = { low: 1, middle: 2, high: 3, variable: 2 };
const HEIGHT_LABEL: Record<ForkRoadHeight, string> = { low: '낮은 도로', middle: '중간 도로', high: '높은 도로', variable: '높이 변화' };
const PANEL_W = 512, PANEL_H = 256;

export type ForkSign = THREE.Mesh & { updateCue(cue: ForkCue | null): void };

/** Every fork gets one panel per route; vertical forks use altitude arrows. */
export function createForkSign(fork: TrackFork, lineColor: string | undefined, y: number, track?: Track): ForkSign | null {
  const cues = forkRouteCues(fork, track);
  if (cues.length < 2 || cues.length !== fork.routes.length || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = PANEL_W * cues.length; canvas.height = PANEL_H;
  const g = canvas.getContext('2d'); if (!g) return null;
  const line = lineColor ?? '#67dcd0', defaultId = defaultBranchRoute(fork).id;
  g.fillStyle = '#07131ef2'; g.fillRect(0, 0, canvas.width, PANEL_H);
  g.strokeStyle = line; g.lineWidth = 6; g.strokeRect(3, 3, canvas.width - 6, PANEL_H - 6);
  g.textAlign = 'left'; g.textBaseline = 'middle';
  cues.forEach((cue, i) => {
    const x = i * PANEL_W;
    if (i) { g.strokeStyle = '#3d6676'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, 18); g.lineTo(x, PANEL_H - 18); g.stroke(); }
    if (cue.choice in LANE_HUES) { g.fillStyle = LANE_HUES[cue.choice as keyof typeof LANE_HUES]; g.fillRect(x + 8, 8, PANEL_W - 16, 10); }
    g.fillStyle = '#7fffe6'; g.font = 'bold 92px sans-serif'; g.textAlign = 'center';
    g.fillText(ARROWS[cue.choice], x + 62, 62);
    g.textAlign = 'left'; g.fillStyle = '#eaffff'; g.font = 'bold 40px sans-serif';
    g.fillText(cue.name, x + 118, 48, 380);
    if (cue.id === defaultId) {
      g.fillStyle = '#ffd86a'; g.fillRect(x + 118, 78, 74, 34); g.fillStyle = '#07131e'; g.font = 'bold 24px sans-serif'; g.fillText('기본', x + 130, 96);
    }
    // 3-step road height bar plus text, so height never relies on colour alone.
    const steps = HEIGHT_STEPS[cue.roadHeight];
    for (let s = 0; s < 3; s++) {
      const h = 14 + s * 12; g.fillStyle = s < steps ? '#7fffe6' : '#2b4a56'; g.fillRect(x + 30 + s * 24, 190 - h, 18, h);
    }
    g.fillStyle = '#c8e4ee'; g.font = 'bold 28px sans-serif'; g.fillText(cue.altitudeHint ? `고도 ${cue.altitudeHint}로 선택` : HEIGHT_LABEL[cue.roadHeight], x + 118, 160);
    const chips: [string, string][] = [];
    if (cue.hazards.includes('height')) chips.push(['⇕', '고도 장애물']);
    if (cue.hazards.includes('corridor')) chips.push(['▥', '통로 게이트']);
    if (cue.features.some(f => f.includes('부스트'))) chips.push(['⚡', '부스트']);
    if (cue.features.some(f => f.includes('점프'))) chips.unshift(['↗', '하강 점프']);
    if (!chips.length) chips.push(['✓', '장애물 없음']);
    chips.slice(0, 2).forEach(([icon, label], k) => {
      const cy = 198 + k * 34 - (chips.length > 1 ? 0 : -8);
      g.fillStyle = cue.hazards.length || icon === '⚡' ? '#ffb15e' : '#9fd6c6'; g.font = 'bold 28px sans-serif'; g.fillText(icon, x + 118, cy);
      g.fillStyle = '#e6f3f7'; g.font = '26px sans-serif'; g.fillText(label, x + 156, cy);
    });
  });
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const width = 12 * cues.length;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * PANEL_H / canvas.width), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, toneMapped: false }));
  mesh.name = `junction-sign-panel-${fork.id}`;
  mesh.position.y = y;
  const clockCanvas = document.createElement('canvas'); clockCanvas.width = 512; clockCanvas.height = 112;
  const clockContext = clockCanvas.getContext('2d');
  const clockTexture = new THREE.CanvasTexture(clockCanvas); clockTexture.colorSpace = THREE.SRGBColorSpace;
  const clock = new THREE.Mesh(new THREE.PlaneGeometry(16, 3.5), new THREE.MeshBasicMaterial({ map: clockTexture, transparent: true, side: THREE.DoubleSide, toneMapped: false }));
  clock.name = `junction-sign-clock-${fork.id}`; clock.position.y = 5; mesh.add(clock);
  let previous = '';
  const updateCue = (cue: ForkCue | null) => {
    const text = cue?.id === fork.id ? forkCountdownText(cue) : '갈림길 · 선택 준비';
    if (!clockContext || text === previous) return;
    previous = text;
    clockContext.clearRect(0, 0, 512, 112); clockContext.fillStyle = '#07131ef2'; clockContext.fillRect(0, 0, 512, 112);
    clockContext.strokeStyle = '#ffd86a'; clockContext.lineWidth = 4; clockContext.strokeRect(2, 2, 508, 108);
    clockContext.fillStyle = '#ffe9a8'; clockContext.textAlign = 'center'; clockContext.textBaseline = 'middle';
    clockContext.font = 'bold 48px sans-serif'; clockContext.fillText(text, 256, 56, 490); clockTexture.needsUpdate = true;
  };
  updateCue(null);
  return Object.assign(mesh, { updateCue });
}
