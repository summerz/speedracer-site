import type { MidiNote } from './midi.js';
interface Voice { source: AudioScheduledSourceNode; nodes: AudioNode[]; gain: GainNode }
// Let the supplied arpeggio, bass and sustained chords carry the arrangement.
// Lead and horn melodies are muted without changing the original MIDI files.
export const MIDI_PART_LEVELS: Readonly<Record<number, number>> = {
  0: .075, 1: .110, 2: .035, 3: 0, 4: 0, 9: 1,
};
/** Six lightweight synth timbres replace the large GM soundfont/MP3 files. */
export function createMidiSynth(context: BaseAudioContext, destination: AudioNode) {
  const voices = new Set<Voice>();
  const noise = context.createBuffer(1, Math.ceil(context.sampleRate * .6), context.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const release = (voice: Voice) => { voice.source.onended = null; voice.nodes.forEach(node => node.disconnect()); voices.delete(voice); };
  const stop = (fade = .035) => {
    const now = context.currentTime;
    for (const voice of [...voices]) {
      voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setTargetAtTime(.0001, now, fade / 3);
      try { voice.source.stop(now + fade); } catch { release(voice); }
    }
  };
  const play = (note: MidiNote, at: number, secondsPerBeat: number) => {
    const partLevel = MIDI_PART_LEVELS[note.channel] ?? 0;
    if (partLevel === 0) return;
    if (voices.size >= 96) return; // Bound mobile CPU even if an imported score is unusually dense.
    const drum = note.channel === 9; const kick = drum && note.pitch <= 36;
    const snare = drum && (note.pitch === 38 || note.pitch === 39);
    const tom = drum && note.pitch >= 41 && note.pitch <= 45 && note.pitch !== 42;
    const tonal = !drum || kick || tom;
    const pad = note.channel === 2; const bass = note.channel === 0; const arp = note.channel === 1;
    const duration = drum ? kick ? .24 : snare ? .16 : tom ? .22 : note.pitch === 49 ? .48 : note.pitch === 46 ? .18 : .045
      : Math.min(8, Math.max(.045, note.duration * secondsPerBeat));
    const tail = drum ? .02 : pad ? .30 : arp ? .07 : .12;
    const gain = context.createGain(); const filter = context.createBiquadFilter();
    filter.type = drum && !tonal ? 'highpass' : 'lowpass';
    filter.frequency.value = drum ? snare ? 1800 : 6500 : bass ? 650 : arp ? 3200 + note.brightness * 4300 : pad ? 2400 : note.channel === 4 ? 1800 : 3200;
    filter.Q.value = arp ? .8 : .5;
    const level = (drum ? kick ? .30 : snare ? .12 : tom ? .12 : .035 : partLevel)
      * note.velocity * (drum ? 1 : Math.max(.3, note.expression));
    const attack = pad ? .07 : .004;
    gain.gain.setValueAtTime(.0001, at); gain.gain.linearRampToValueAtTime(level, at + attack);
    if (drum || arp) gain.gain.exponentialRampToValueAtTime(.0001, at + duration + tail);
    else {
      gain.gain.linearRampToValueAtTime(level * .65, at + Math.min(duration, attack + .15));
      gain.gain.setValueAtTime(level * .65, at + duration);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration + tail);
    }
    let source: AudioBufferSourceNode | OscillatorNode;
    if (tonal) {
      const oscillator = context.createOscillator();
      oscillator.type = drum ? 'sine' : note.channel === 4 ? 'triangle' : 'sawtooth';
      if (pad) oscillator.detune.value = note.pitch % 2 ? 5 : -5;
      const hz = drum ? kick ? 145 : 180 - (note.pitch - 41) * 18 : 440 * 2 ** ((note.pitch - 69) / 12);
      oscillator.frequency.setValueAtTime(hz, at);
      if (drum) oscillator.frequency.exponentialRampToValueAtTime(kick ? 42 : 65, at + duration * .7);
      source = oscillator;
    } else { const buffer = context.createBufferSource(); buffer.buffer = noise; source = buffer; }
    const pan = context.createStereoPanner(); pan.pan.value = Math.max(-1, Math.min(1, note.pan)) * .55;
    source.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(destination);
    const voice = { source, nodes: [source, filter, gain, pan], gain }; voices.add(voice);
    source.onended = () => release(voice); source.start(at); source.stop(at + duration + tail);
  };
  return { play, stop, get voiceCount() { return voices.size; }, dispose() { stop(0); voices.forEach(release); } };
}
