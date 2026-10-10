import type { RenderQuality } from './renderQuality.js';

export type QualityPreference = RenderQuality | 'auto';
export type QualityReason = 'initial' | 'startup' | 'sustained' | 'manual' | 'auto';
export interface FrameMetrics {
  /** Preset used while collecting these frames, before any resulting downgrade. */
  measuredQuality: RenderQuality;
  samples: number;
  averageMs: number;
  p95Ms: number;
  fps: number;
}
export interface QualityStatus {
  preference: QualityPreference;
  quality: RenderQuality;
  phase: 'warming' | 'measuring' | 'monitoring' | 'manual';
  reason: QualityReason;
  metrics: FrameMetrics | null;
}
export type QualityListener = (status: QualityStatus) => void;
export interface QualityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface QualityPreferenceStore {
  read(): QualityPreference;
  save(value: QualityPreference): void;
}
export interface AutomaticQuality {
  snapshot(): QualityStatus;
  onChange(listener: QualityListener): () => void;
  setPreference(value: QualityPreference): QualityStatus;
  sample(frameMs: number, active?: boolean): QualityStatus | null;
}

/** Auto is the default; denied or corrupt storage cannot prevent rendering. */
export function createQualityPreferenceStore(storage?: QualityStorage): QualityPreferenceStore {
  const key = 'speedracer:quality';
  let preference: QualityPreference = 'auto';
  try {
    const value = storage?.getItem(key);
    if (value === 'auto' || value === 'low' || value === 'balanced' || value === 'high') preference = value;
  } catch { /* Optional preference. */ }
  return {
    read: () => preference,
    save(value: QualityPreference) {
      preference = value;
      try { storage?.setItem(key, value); } catch { /* Keep the selection for this session. */ }
    },
  };
}

const lower = (quality: RenderQuality): RenderQuality => quality === 'high' ? 'balanced' : 'low';

/** Bounded measurements of real frame intervals; never use the physics clock. */
export function createAutomaticQuality(preference: QualityPreference = 'auto'): AutomaticQuality {
  let selected = preference;
  let quality: RenderQuality = preference === 'auto' ? 'high' : preference;
  let reason: QualityReason = preference === 'auto' ? 'initial' : 'manual';
  let warmupMs = 1000;
  let startup = true;
  let elapsed = 0;
  let cooldownMs = 0;
  let slowWindows = 0;
  let metrics: FrameMetrics | null = null;
  const frames: number[] = [];
  const listeners = new Set<QualityListener>();
  const clearWindow = () => { elapsed = 0; frames.length = 0; };
  const status = (): QualityStatus => ({ preference: selected, quality,
    phase: selected !== 'auto' ? 'manual' : warmupMs > 0 ? 'warming' : startup ? 'measuring' : 'monitoring',
    reason, metrics: metrics ? { ...metrics } : null });
  return {
    snapshot: status,
    /** Initial delivery allows the renderer to apply a persisted manual setting immediately. */
    onChange(listener: QualityListener) {
      listeners.add(listener); listener(status());
      return () => { listeners.delete(listener); };
    },
    setPreference(value: QualityPreference) {
      if (selected === value) return status();
      selected = value; quality = value === 'auto' ? 'high' : value;
      reason = value === 'auto' ? 'auto' : 'manual';
      startup = true; warmupMs = 1000; cooldownMs = 0; slowWindows = 0; metrics = null; clearWindow();
      listeners.forEach(listener => listener(status())); return status();
    },
    /** Returns a report at the end of each window, even if quality is unchanged. */
    sample(frameMs: number, active = true): QualityStatus | null {
      if (!active || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) {
        clearWindow(); warmupMs = 1000; slowWindows = 0; return null;
      }
      cooldownMs = Math.max(0, cooldownMs - frameMs);
      if (warmupMs > 0) { warmupMs = Math.max(0, warmupMs - frameMs); return null; }
      elapsed += frameMs;
      // A rolling bound also covers devices with refresh rates above 240 Hz.
      frames.push(frameMs); if (frames.length > 1000) frames.shift();
      if (elapsed < (startup ? 3000 : 4000) || frames.length < 30) return null;
      const sorted = [...frames].sort((a, b) => a - b);
      const averageMs = frames.reduce((sum, time) => sum + time, 0) / frames.length;
      metrics = { measuredQuality: quality, samples: frames.length, averageMs,
        p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], fps: 1000 / averageMs };
      const oldQuality = quality;
      if (selected === 'auto') {
        if (startup) {
          quality = averageMs > 30 || metrics.p95Ms > 40 ? 'low'
            : averageMs > 19 || metrics.p95Ms > 25 ? 'balanced' : 'high';
          reason = 'startup'; cooldownMs = 10000;
        } else if (cooldownMs === 0 && quality !== 'low') {
          slowWindows = averageMs > 23 || metrics.p95Ms > 35 ? slowWindows + 1 : 0;
          if (slowWindows >= 2) {
            quality = lower(quality); reason = 'sustained'; cooldownMs = 10000; slowWindows = 0;
          }
        } else slowWindows = 0;
      }
      startup = false; clearWindow();
      const next = status();
      if (quality !== oldQuality) listeners.forEach(listener => listener(status()));
      return next;
    },
  };
}
