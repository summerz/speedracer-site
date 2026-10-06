export type FileSoundCue = 'impact' | 'electric-impact' | 'off-track'
  | 'boost-on' | 'boost-stage2' | 'boost-full' | 'boost-complete'
  | 'warning-up' | 'warning-down' | 'height' | 'recovery' | 'thunder'
  | 'countdown' | 'start' | 'half-lap' | 'lap' | 'final-lap' | 'finish';
export interface SoundEffectFile { url: string; level: number }
export type RaceEffectFiles = Partial<Record<FileSoundCue, SoundEffectFile>>;

// Share encoded bytes across race restarts. Vite gives each changed file a new URL.
const encoded = new Map<string, Promise<ArrayBuffer>>();
const load = (url: string) => {
  let request = encoded.get(url);
  if (!request) {
    request = fetch(url).then(response => {
      if (!response.ok) throw new Error('Sound file unavailable');
      return response.arrayBuffer();
    });
    encoded.set(url, request);
    void request.catch(() => { encoded.delete(url); });
  }
  return request;
};

/** Fetch before the gesture; decode after activation. Never queue delayed playback. */
export function createSoundEffectBank(files: RaceEffectFiles) {
  const buffers = new Map<FileSoundCue, AudioBuffer>();
  const pending = new Map<FileSoundCue, Promise<void>>();
  let disposed = false;
  for (const file of Object.values(files)) void load(file.url).catch(() => {});
  return {
    async prepare(context: AudioContext) {
      if (disposed) return;
      await Promise.all((Object.keys(files) as FileSoundCue[]).map(cue => {
        if (buffers.has(cue)) return;
        const current = pending.get(cue);
        if (current) return current;
        const request = load(files[cue]!.url)
          // decodeAudioData may detach its input; preserve shared encoded bytes.
          .then(bytes => context.decodeAudioData(bytes.slice(0)))
          .then(buffer => { if (!disposed && context.state !== 'closed') buffers.set(cue, buffer); })
          .catch(() => { /* Use synthesis until a later activation can retry. */ })
          .finally(() => { pending.delete(cue); });
        pending.set(cue, request);
        return request;
      }));
    },
    get(cue: FileSoundCue) {
      const buffer = buffers.get(cue);
      return buffer && !disposed ? { buffer, level: files[cue]!.level } : undefined;
    },
    dispose() { disposed = true; buffers.clear(); },
  };
}
