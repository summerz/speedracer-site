// Shared 효과음 preference (header toggle + race button), persisted like speedracer-music.
export const sfxPreference = {
  get enabled() { try { return localStorage.getItem('speedracer-sfx') !== 'off'; } catch { return true; } },
  set(enabled: boolean) { try { localStorage.setItem('speedracer-sfx', enabled ? 'on' : 'off'); } catch { /* Optional preference. */ } },
};
