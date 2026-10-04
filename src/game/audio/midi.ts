export interface MidiNote { beat: number; duration: number; channel: number; pitch: number; velocity: number; expression: number; pan: number; brightness: number }
export interface MidiScore { bpm: number; beats: number; notes: MidiNote[] }

/** Reads PPQ type 0/1 SMF scores, including running status and controller state. */
export function readMidi(buffer: ArrayBuffer): MidiScore {
  const data = new Uint8Array(buffer); const view = new DataView(buffer); let pos = 0;
  const byte = () => { if (pos >= data.length) throw new Error('Truncated MIDI'); return data[pos++]; };
  const uint = (length: number) => { let value = 0; for (let i = 0; i < length; i++) value = value * 256 + byte(); return value; };
  const tag = () => String.fromCharCode(byte(), byte(), byte(), byte());
  const variable = () => { let value = 0; for (let i = 0; i < 4; i++) { const b = byte(); value = value * 128 + (b & 127); if (!(b & 128)) return value; } throw new Error('Invalid MIDI delta'); };
  if (tag() !== 'MThd' || uint(4) !== 6) throw new Error('Invalid MIDI header');
  const format = uint(2); const count = uint(2); const ppq = uint(2);
  if (format > 1 || !count || !ppq || ppq & 0x8000) throw new Error('Unsupported MIDI format');
  let bpm = 120; let tempo: number | undefined; let beats = 0;
  const notes: MidiNote[] = [];
  for (let track = 0; track < count; track++) {
    if (tag() !== 'MTrk') throw new Error('Invalid MIDI track');
    const length = uint(4); const end = pos + length; if (end > data.length) throw new Error('Truncated MIDI track');
    let tick = 0; let status = 0;
    const expression = Array(16).fill(1); const volume = Array(16).fill(1); const pan = Array(16).fill(0); const brightness = Array(16).fill(1);
    const held = new Map<string, MidiNote[]>();
    while (pos < end) {
      tick += variable(); let event = byte();
      if (event < 128) { if (!status) throw new Error('Invalid running status'); pos--; event = status; }
      if (event === 0xff) {
        status = 0; const type = byte(); const length = variable();
        if (pos + length > end) throw new Error('Truncated MIDI metadata');
        if (type === 0x51 && length === 3) {
          const micros = view.getUint8(pos) * 65536 + view.getUint8(pos + 1) * 256 + view.getUint8(pos + 2);
          if (!micros || tempo !== undefined && micros !== tempo) throw new Error('Changing MIDI tempo is unsupported');
          tempo = micros; bpm = 60_000_000 / micros;
        }
        pos += length; continue;
      }
      if (event === 0xf0 || event === 0xf7) { status = 0; const length = variable(); pos += length; if (pos > end) throw new Error('Truncated MIDI sysex'); continue; }
      if (event >= 0xf0) throw new Error('Unsupported MIDI event');
      status = event; const kind = event >> 4; const channel = event & 15;
      const first = byte(); const second = kind === 12 || kind === 13 ? 0 : byte();
      if (first > 127 || second > 127) throw new Error('Invalid MIDI data');
      const key = `${channel}:${first}`;
      if (kind === 9 && second > 0) {
        const note = { beat: tick / ppq, duration: 0, channel, pitch: first, velocity: second / 127,
          expression: expression[channel] * volume[channel], pan: pan[channel], brightness: brightness[channel] };
        const queue = held.get(key) ?? []; queue.push(note); held.set(key, queue); notes.push(note);
      } else if (kind === 8 || kind === 9) {
        const note = held.get(key)?.shift(); if (note) note.duration = (tick / ppq) - note.beat;
      } else if (kind === 11) {
        if (first === 11) expression[channel] = second / 127;
        if (first === 7) volume[channel] = second / 127;
        if (first === 10) pan[channel] = (second - 64) / 64;
        if (first === 74) brightness[channel] = second / 127;
      }
      if (pos > end) throw new Error('Truncated MIDI event');
    }
    beats = Math.max(beats, tick / ppq);
    for (const queue of held.values()) for (const note of queue) note.duration = tick / ppq - note.beat;
  }
  return { bpm, beats, notes: notes.filter(note => note.duration > 0).sort((a, b) => a.beat - b.beat || a.channel - b.channel) };
}
