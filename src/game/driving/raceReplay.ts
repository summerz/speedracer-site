/** Ring buffer of the player's last seconds of running (pose, speed, thrust mode) for the finish replay; no three.js, no allocation per call. */
export const REPLAY_SECONDS = 3.5, REPLAY_HZ = 60;
export interface ReplayPose { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; speed: number; mode: number }
const STRIDE = 10;

export function createReplayBuffer(capacity = Math.ceil((REPLAY_SECONDS + 1) * REPLAY_HZ * 1.2)) {
  const data = new Float32Array(capacity * STRIDE);
  let start = 0, count = 0, lastT = -Infinity;
  const at = (i: number) => ((start + i) % capacity) * STRIDE;
  const timeAt = (i: number) => data[at(i)];
  const seconds = () => count < 2 ? 0 : Math.min(REPLAY_SECONDS, timeAt(count - 1) - timeAt(0));
  return {
    reset() { start = 0; count = 0; lastT = -Infinity; },
    /** `t` is a monotonic clock in seconds; samples closer than 1/70 s are dropped unless `force`. */
    record(t: number, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number, speed: number, mode: number, force = false) {
      if (!force && t - lastT < 1 / 70) return;
      if (count === capacity) { start = (start + 1) % capacity; count--; }
      const o = at(count); data[o] = t; data[o + 1] = x; data[o + 2] = y; data[o + 3] = z; data[o + 4] = qx; data[o + 5] = qy; data[o + 6] = qz; data[o + 7] = qw; data[o + 8] = speed; data[o + 9] = mode; count++; lastT = t;
    },
    seconds,
    /** Pose at `u` (0..1) of the last `seconds()`, interpolated; the thrust mode is the earlier sample's. Null until two samples exist. */
    sample(u: number, out: ReplayPose): ReplayPose | null {
      const length = seconds(); if (!length) return null;
      const target = timeAt(count - 1) - length * (1 - Math.min(1, Math.max(0, u)));
      let lo = 0, hi = count - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (timeAt(mid) <= target) lo = mid; else hi = mid; }
      const a = at(lo), b = at(hi), span = data[b] - data[a], f = span > 1e-9 ? Math.min(1, Math.max(0, (target - data[a]) / span)) : 0;
      const mix = (k: number) => data[a + k] + (data[b + k] - data[a + k]) * f;
      const sign = data[a + 4] * data[b + 4] + data[a + 5] * data[b + 5] + data[a + 6] * data[b + 6] + data[a + 7] * data[b + 7] < 0 ? -1 : 1;
      const qx = data[a + 4] + (sign * data[b + 4] - data[a + 4]) * f, qy = data[a + 5] + (sign * data[b + 5] - data[a + 5]) * f;
      const qz = data[a + 6] + (sign * data[b + 6] - data[a + 6]) * f, qw = data[a + 7] + (sign * data[b + 7] - data[a + 7]) * f;
      const norm = Math.hypot(qx, qy, qz, qw) || 1;
      out.x = mix(1); out.y = mix(2); out.z = mix(3); out.qx = qx / norm; out.qy = qy / norm; out.qz = qz / norm; out.qw = qw / norm; out.speed = mix(8); out.mode = data[a + 9];
      return out;
    },
  };
}
