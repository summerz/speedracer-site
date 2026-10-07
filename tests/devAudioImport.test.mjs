import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateExport, importDevAudio } from '../scripts/import-dev-audio.mjs';
const exportData = overrides => ({ format: 'speedracer-dev-audio', version: 2, library: [], overrides });
test('project import rejects unknown events, invalid gains and conflicting shared-file assignments', () => {
  assert.throws(() => validateExport(exportData([{ id: 'sfx:../../evil', data: 'YQ==' }])), /Unknown/);
  assert.throws(() => validateExport(exportData([{ id: 'sfx:start', level: NaN }])), /gain/);
  assert.throws(() => validateExport(exportData([{ id: 'sfx:height', data: 'YQ==' }, { id: 'sfx:recovery', data: 'Yg==' }])), /Shared-file conflict/);
  assert.equal(validateExport(exportData([{ id: 'sfx:height', data: 'YQ==' }, { id: 'sfx:recovery', data: 'YQ==' }])).size, 1);
});
test('import validates real audio, preserves unused candidates and backs up project files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'speedracer-import-test-'));
  try {
    const data = exportData([{ id: 'sfx:warning-up', name: 'clear.mp3', level: .28, data: (await readFile('src/assets/audio/agent-audio/warning-down.mp3')).toString('base64') }]);
    data.library = [{ id: 'unused-choice', kind: 'sfx', name: 'unused.mp3', data: data.overrides[0].data }];
    const filename = join(root, 'export.json'); await writeFile(filename, JSON.stringify(data));
    const assets = join(root, 'src/assets/audio/agent-audio'); await mkdir(assets, { recursive: true });
    await writeFile(join(assets, 'warning-up.mp3'), 'previous-file');
    const dry = await importDevAudio(filename, { root, dryRun: true });
    assert.equal(dry.assets.length, 1); assert.equal(dry.libraryFiles, 1);
    assert.equal(await readFile(join(assets, 'warning-up.mp3'), 'utf8'), 'previous-file');
    const result = await importDevAudio(filename, { root });
    assert.equal(await readFile(join(result.archive, 'before/src/assets/audio/agent-audio/warning-up.mp3'), 'utf8'), 'previous-file');
    const archived = JSON.parse(await readFile(join(result.archive, 'library.json')));
    assert.equal(archived.library[0].id, 'unused-choice');
    const levels = JSON.parse(await readFile(join(root, 'src/assets/audio/effect-levels.json')));
    assert.equal(levels['warning-up'], .28);
    assert.ok((await readFile(join(assets, 'warning-up.mp3'))).length > 1000);
    const manifest = JSON.parse(await readFile(join(assets, 'manifest.json')));
    assert.equal(manifest.effects[0].sourceType, 'dev-library-import');
    assert.ok(manifest.effects[0].peak > 0 && manifest.effects[0].peak < 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('playlist import validates filenames and preserves excluded originals while adopting new tracks', async () => {
  const data = exportData([]);
  data.musicPlaylist = [{ file: '../unsafe.mp3', title: 'Unsafe' }];
  assert.throws(() => validateExport(data), /Unknown/);
  data.musicPlaylist = [{ file: 'library-safe.mp3', title: 'New soundtrack', data: (await readFile('src/assets/audio/agent-audio/warning-down.mp3')).toString('base64') }];
  const root = await mkdtemp(join(tmpdir(), 'speedracer-playlist-test-'));
  try {
    const musicDir = join(root, 'public/music/ost'); await mkdir(musicDir, { recursive: true });
    await writeFile(join(musicDir, 'racing-1-obsidian-horizon.mp3'), 'keep excluded original');
    const filename = join(root, 'export.json'); await writeFile(filename, JSON.stringify(data));
    await importDevAudio(filename, { root, dryRun: true });
    await assert.rejects(readFile(join(root, 'src/assets/audio/music-playlist.json')), /ENOENT/);
    await importDevAudio(filename, { root });
    const playlist = JSON.parse(await readFile(join(root, 'src/assets/audio/music-playlist.json')));
    assert.deepEqual(playlist, [{ file: 'library-safe.mp3', title: 'New soundtrack' }]);
    assert.ok((await readFile(join(musicDir, 'library-safe.mp3'))).length > 1000);
    assert.equal(await readFile(join(musicDir, 'racing-1-obsidian-horizon.mp3'), 'utf8'), 'keep excluded original');
  } finally { await rm(root, { recursive: true, force: true }); }
});
