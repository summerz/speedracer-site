import importedLevels from '../../assets/audio/effect-levels.json';
import impact from '../../assets/audio/agent-audio/impact.mp3';
import electricImpact from '../../assets/audio/agent-audio/electric-impact.mp3';
import offTrack from '../../assets/audio/agent-audio/off-track.mp3';
import boostOn from '../../assets/audio/agent-audio/boost-on.mp3';
import boostStage2 from '../../assets/audio/agent-audio/boost-stage2.mp3';
import boostFull from '../../assets/audio/agent-audio/boost-full.mp3';
import boostComplete from '../../assets/audio/agent-audio/boost-complete.mp3';
import warningUp from '../../assets/audio/agent-audio/warning-up.mp3';
import warningDown from '../../assets/audio/agent-audio/warning-down.mp3';
import height from '../../assets/audio/agent-audio/height.mp3';
import countdown from '../../assets/audio/agent-audio/countdown.mp3';
import start from '../../assets/audio/agent-audio/start.mp3';
import lap from '../../assets/audio/agent-audio/lap.mp3';
import finalLap from '../../assets/audio/agent-audio/final-lap.mp3';
import finish from '../../assets/audio/agent-audio/finish.mp3';
import thunder from '../../assets/audio/agent-audio/thunder.mp3';
import type { RaceEffectFiles } from './soundEffectBank.js';

// Imported resources receive content hashes and are included in the PWA shell.
const defaultFiles: RaceEffectFiles = {
  impact: { url: impact, level: .52 },
  'electric-impact': { url: electricImpact, level: .52 },
  'off-track': { url: offTrack, level: .38 },
  'boost-on': { url: boostOn, level: .3 },
  'boost-stage2': { url: boostStage2, level: .45 },
  'boost-full': { url: boostFull, level: .4 },
  'boost-complete': { url: boostComplete, level: .3 },
  'warning-up': { url: warningUp, level: .24 },
  'warning-down': { url: warningDown, level: .24 },
  height: { url: height, level: .12 },
  recovery: { url: height, level: .18 },
  countdown: { url: countdown, level: .3 },
  start: { url: start, level: .36 },
  'half-lap': { url: lap, level: .23 },
  lap: { url: lap, level: .35 },
  'final-lap': { url: finalLap, level: .4 },
  finish: { url: finish, level: .32 },
  thunder: { url: thunder, level: .32 },
};

const levels = importedLevels as Partial<Record<keyof RaceEffectFiles, number>>;
export const RACE_EFFECT_FILES = Object.fromEntries(Object.entries(defaultFiles).map(([cue, file]) => [cue, { ...file, level: levels[cue as keyof RaceEffectFiles] ?? file.level }])) as RaceEffectFiles;
