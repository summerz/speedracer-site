import * as THREE from 'three';
import { forkRouteCues, type ForkChoice, type ForkRoadHeight } from './forkCue.js';
import type { TrackFork } from './trackBranches.js';

const ARROWS: Record<ForkChoice, string> = { left: '←', center: '↑', right: '→', lower: '↓', upper: '↑' };
const HEIGHT_STEPS: Record<ForkRoadHeight, number> = { low: 1, middle: 2, high: 3, variable: 2 };
const HEIGHT_LABEL: Record<ForkRoadHeight, string> = { low: '낮은 도로', middle: '중간 도로', high: '높은 도로', variable: '높이 변화' };
const PANEL_W = 512, PANEL_H = 256;

/** Overhead sign for forks whose routes carry display cues; one panel per route in left-to-right order. Null when cues are missing. */
export function createForkSign(fork: TrackFork, lineColor: string | undefined, y: number): THREE.Mesh | null {
  const cues = forkRouteCues(fork);
  if (cues.length < 2 || cues.length !== fork.routes.length || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = PANEL_W * cues.length; canvas.height = PANEL_H;
  const g = canvas.getContext('2d'); if (!g) return null;
  const line = lineColor ?? '#67dcd0', defaultId = fork.routes.find(r => r.id === fork.defaultRouteId)?.id ?? cues[Math.floor(cues.length / 2)].id;
  g.fillStyle = '#07131ef2'; g.fillRect(0, 0, canvas.width, PANEL_H);
  g.strokeStyle = line; g.lineWidth = 6; g.strokeRect(3, 3, canvas.width - 6, PANEL_H - 6);
  g.textAlign = 'left'; g.textBaseline = 'middle';
  cues.forEach((cue, i) => {
    const x = i * PANEL_W;
    if (i) { g.strokeStyle = '#3d6676'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, 18); g.lineTo(x, PANEL_H - 18); g.stroke(); }
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
    g.fillStyle = '#c8e4ee'; g.font = 'bold 28px sans-serif'; g.fillText(HEIGHT_LABEL[cue.roadHeight], x + 118, 160);
    const chips: [string, string][] = [];
    if (cue.hazards.includes('height')) chips.push(['⇕', '고도 장애물']);
    if (cue.hazards.includes('corridor')) chips.push(['▥', '통로 게이트']);
    if (cue.features.some(f => f.includes('부스트'))) chips.push(['⚡', '부스트']);
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
  mesh.position.y = y; return mesh;
}
