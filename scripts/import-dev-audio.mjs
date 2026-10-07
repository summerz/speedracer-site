#!/usr/bin/env node
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cues = ['impact', 'electric-impact', 'off-track', 'boost-on', 'boost-stage2', 'boost-full', 'boost-complete', 'warning-up', 'warning-down', 'height', 'recovery', 'countdown', 'start', 'half-lap', 'lap', 'final-lap', 'finish', 'thunder'];
const songs = ['lobby-before-the-real-dark', 'racing-1-obsidian-horizon', 'racing-2-beneath-the-steel-canopy', 'racing-3-steel-gemini', 'racing-4-horizon-pursuit', 'racing-5-midnight-apex', 'racing-6-weight-of-the-machine', 'racing-7-iron-spires-falling', 'racing-8-apex-monitor'].map(name => `${name}.mp3`);
export const targetFor = id => {
  if (typeof id !== 'string') throw new Error('Missing audio event id');
  const [kind, name] = id.split(':');
  if (kind === 'sfx' && cues.includes(name) && id === `sfx:${name}`) return `src/assets/audio/agent-audio/${name === 'recovery' ? 'height' : name === 'half-lap' ? 'lap' : name}.mp3`;
  if (kind === 'music' && (songs.includes(name) || /^library-[a-zA-Z0-9-]+\.mp3$/.test(name)) && id === `music:${name}`) return `public/music/ost/${name}`;
  throw new Error(`Unknown audio event: ${id}`);
};
export function validateExport(data) {
  if (data?.format !== 'speedracer-dev-audio' || ![1, 2].includes(data.version) || !Array.isArray(data.overrides)) throw new Error('Invalid Speedracer audio export');
  const paths = new Map(), ids = new Set();
  const playlist = data.musicPlaylist;
  if (playlist !== undefined) {
    if (!Array.isArray(playlist) || !playlist.length || playlist.length > 100) throw new Error('Invalid music playlist');
    const files = new Set();
    for (const song of playlist) {
      if (!song || typeof song.file !== 'string' || typeof song.title !== 'string' || !song.title.trim() || song.title.length > 200 || files.has(song.file)) throw new Error('Invalid or duplicate playlist track');
      targetFor(`music:${song.file}`); files.add(song.file);
    }
  }
  const importedTracks = (playlist ?? []).filter(song => song.data !== undefined).map(song => ({ ...song, id: `music:${song.file}` }));
  for (const item of [...data.overrides, ...importedTracks]) {
    const path = targetFor(item?.id);
    if (ids.has(item.id)) throw new Error(`Duplicate event: ${item.id}`); ids.add(item.id);
    if (item.level !== undefined && (!Number.isFinite(item.level) || item.level < 0 || item.level > 1)) throw new Error(`Invalid gain: ${item.id}`);
    if (item.data !== undefined) {
      if (typeof item.data !== 'string' || !item.data || item.data.length > 45 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw new Error(`Invalid audio bytes: ${item.id}`);
      const bytes = Buffer.from(item.data, 'base64');
      if (bytes.toString('base64') !== item.data) throw new Error(`Invalid base64: ${item.id}`);
      const previous = paths.get(path);
      if (previous && !previous.bytes.equals(bytes)) throw new Error(`Shared-file conflict: ${previous.id} and ${item.id} both write ${path}. Choose the same file for both events, or restore one before exporting.`);
      paths.set(path, { ...item, bytes, path });
    }
  }
  return paths;
}
export async function importDevAudio(filename, { root = process.cwd(), dryRun = false } = {}) {
  const source = await readFile(filename);
  if (source.length > 150 * 1024 * 1024) throw new Error('Export exceeds 150 MB');
  const data = JSON.parse(source), paths = validateExport(data);
  if (data.library !== undefined && (!Array.isArray(data.library) || data.library.some(item => !item || !['sfx', 'music'].includes(item.kind) || typeof item.name !== 'string' || typeof item.data !== 'string'))) throw new Error('Invalid library');
  const staging = await mkdtemp(join(tmpdir(), 'speedracer-audio-'));
  try {
    const assets = [], changes = new Map();
    for (const [path, item] of paths) {
      const input = join(staging, `${assets.length}.input`), output = join(staging, `${assets.length}.mp3`);
      await writeFile(input, item.bytes);
      const sfx = item.id.startsWith('sfx:');
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', input], { encoding: 'utf8' }));
      const seconds = Number(probe.format.duration);
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > (sfx ? 3.1 : 1200)) throw new Error(`Invalid duration: ${item.id}`);
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', input, '-vn', '-ar', '44100', '-ac', sfx ? '1' : '2', '-c:a', 'libmp3lame', '-b:a', sfx ? '96k' : '64k', '-map_metadata', '-1', '-id3v2_version', '0', output]);
      const bytes = await readFile(output), info = { id: item.id, path, bytes: bytes.length, sha256: hash(bytes), durationSeconds: seconds };
      if (sfx) {
        const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 'f32le', '-ac', '1', '-'], { maxBuffer: 2 * 1024 * 1024 });
        let peak = 0, sum = 0; for (let i = 0; i < raw.length; i += 4) { const value = raw.readFloatLE(i); if (!Number.isFinite(value)) throw new Error('Non-finite audio'); peak = Math.max(peak, Math.abs(value)); sum += value * value; }
        if (peak < .0001 || peak >= 1) throw new Error(`Silent or clipped sound: ${item.id}`);
        Object.assign(info, { peak, rms: Math.sqrt(sum / (raw.length / 4)), sampleRate: 44100, channels: 1 });
      }
      assets.push(info); changes.set(path, bytes);
    }
    for (const song of data.musicPlaylist ?? []) { const path = targetFor(`music:${song.file}`); if (!paths.has(path)) await readFile(resolve(root, path)); }
    const report = { dryRun, assets, libraryFiles: data.library?.length ?? 0, gains: data.overrides.filter(item => item.level !== undefined && item.id.startsWith('sfx:')).length };
    if (dryRun) return report;
    const readJson = async (path, fallback) => { try { return JSON.parse(await readFile(resolve(root, path), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } };
    const levelsPath = 'src/assets/audio/effect-levels.json', levels = await readJson(levelsPath, {});
    for (const item of data.overrides) if (item.id.startsWith('sfx:') && item.level !== undefined) levels[item.id.slice(4)] = item.level;
    if (data.musicPlaylist) {
      for (const song of data.musicPlaylist) {
        const path = targetFor(`music:${song.file}`);
        if (!paths.has(path)) await readFile(resolve(root, path));
      }
      changes.set('src/assets/audio/music-playlist.json', Buffer.from(`${JSON.stringify(data.musicPlaylist.map(({ file, title }) => ({ file, title })), null, 2)}\n`));
    }
    changes.set(levelsPath, Buffer.from(`${JSON.stringify(levels, null, 2)}\n`));
    if (assets.some(item => item.id.startsWith('sfx:'))) {
      const manifestPath = 'src/assets/audio/agent-audio/manifest.json', manifest = await readJson(manifestPath, { version: 0, effects: [] });
      manifest.version++; manifest.listeningVerified = false;
      for (const item of assets.filter(item => item.id.startsWith('sfx:'))) {
        const original = manifest.effects.find(effect => effect.file === item.path.split('/').at(-1));
        const record = { cue: original?.cue ?? item.id.slice(4), file: item.path.split('/').at(-1), sourceType: 'dev-library-import', sourceName: paths.get(item.path).name, sourceSha256: hash(paths.get(item.path).bytes), importedAt: new Date().toISOString(), ...item };
        if (original) { record.previousSource = { sourcePath: original.sourcePath, sourceSha256: original.sourceSha256, sha256: original.sha256 }; Object.assign(original, record); delete original.prompt; delete original.edit; delete original.sourcePath; delete original.sourceRevision; }
        else manifest.effects.push(record);
      }
      changes.set(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    }
    // Keep every unused candidate as well as an exact export and backups of changed project files.
    const archive = resolve(root, 'incoming-resources/audio-library', hash(source).slice(0, 16));
    await mkdir(archive, { recursive: true }); await writeFile(join(archive, 'library.json'), source);
    const backups = new Map();
    for (const path of changes.keys()) {
      const target = resolve(root, path); let previous;
      try { previous = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      backups.set(path, previous);
      if (previous) { const backup = join(archive, 'before', path); await mkdir(dirname(backup), { recursive: true }); try { await writeFile(backup, previous, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
    }
    try { for (const [path, bytes] of changes) { const target = resolve(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); } }
    catch (error) { for (const [path, bytes] of backups) { if (bytes) await writeFile(resolve(root, path), bytes); else await rm(resolve(root, path), { force: true }); } throw error; }
    return { ...report, archive };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), filename = args.find(arg => !arg.startsWith('--'));
  if (!filename || args.some(arg => arg.startsWith('--') && arg !== '--dry-run')) { console.error('Usage: npm run audio:import -- <export.json> [--dry-run]'); process.exitCode = 1; }
  else try { console.log(JSON.stringify(await importDevAudio(resolve(filename), { dryRun: args.includes('--dry-run') }), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
