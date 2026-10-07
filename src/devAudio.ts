import { RACE_EFFECT_FILES } from './game/audio/raceEffectFiles';
import { setSoundEffectResolver, type FileSoundCue } from './game/audio/soundEffectBank';
import { SOUNDTRACKS, soundtrack } from './game/audio/soundtrack';
import { createDevAudioStore, type DevAudioOverride, type DevAudioLibraryFile, type DevAudioKind } from './devAudioStore';

const labels: Record<FileSoundCue, string> = {
  impact: '기체 충돌', 'electric-impact': '장애물 충돌', 'off-track': '경로 이탈',
  'boost-on': '부스트 진입', 'boost-stage2': '부스트 2단계', 'boost-full': '부스트 충전 완료',
  'boost-complete': '부스트 완전 사용 성공', 'warning-up': '고도 상승 경고', 'warning-down': '고도 하강 경고',
  height: '고도 변경', recovery: '복귀', countdown: '출발 카운트다운', start: '출발',
  'half-lap': '반 랩 통과', lap: '랩 통과', 'final-lap': '마지막 랩', finish: '레이스 종료', thunder: '천둥',
};
export const DEV_AUDIO_CATALOG = [
  ...Object.entries(RACE_EFFECT_FILES).map(([cue, file]) => ({
    id: `sfx:${cue}`, title: labels[cue as FileSoundCue], kind: 'sfx' as const, url: file.url, level: file.level,
    path: `src/assets/audio/agent-audio/${cue === 'recovery' ? 'height' : cue === 'half-lap' ? 'lap' : cue}.mp3`,
  })),
  ...SOUNDTRACKS.map((song, index) => ({
    id: `music:${song.file}`, title: song.title, kind: 'music' as const,
    url: `${import.meta.env.BASE_URL}music/ost/${song.file}`, level: .55,
    path: `public/music/ost/${song.file}`, scene: index === 0 ? '로비' : `사운드트랙 #${index}`,
  })),
];
export type DevAudioEntry = typeof DEV_AUDIO_CATALOG[number];
export interface DevLibraryEntry {
  id: string; title: string; kind: DevAudioKind; name: string; url: string;
  source: 'project' | 'upload' | 'agent'; duration?: number; added: number; size?: number;
}
const records = new Map<string, DevAudioOverride>();
const library = new Map<string, DevAudioLibraryFile>();
const urls = new Map<string, string>();
let store: ReturnType<typeof createDevAudioStore>;
let initialized: Promise<void> | undefined;
const originalId = (entry: DevAudioEntry) => `original:${entry.path}`;
const originals = [...new Map(DEV_AUDIO_CATALOG.map(entry => [originalId(entry), {
  id: originalId(entry), title: entry.title, kind: entry.kind, name: entry.path.split('/').at(-1)!,
  url: entry.url, source: 'project' as const, added: 0,
}])).values()];
export function devAudioLibrary(): DevLibraryEntry[] {
  return [...[...library.values()].sort((a, b) => b.added - a.added).map(record => ({
    ...record, url: urls.get(record.id)!, size: record.blob.size,
  })), ...originals];
}
const installLibrary = (record: DevAudioLibraryFile) => {
  const old = urls.get(record.id); if (old) URL.revokeObjectURL(old);
  library.set(record.id, record); urls.set(record.id, URL.createObjectURL(record.blob));
};
export const devAudioUsage = (entry: DevAudioEntry) => {
  if (entry.kind !== 'music') return entry.title;
  if (entry.scene === '로비') return '로비';
  const index = DEV_AUDIO_CATALOG.filter(item => item.kind === 'music' && item.scene !== '로비' && devAudioIncluded(item)).findIndex(item => item.id === entry.id);
  return index < 0 ? '사운드트랙 (제외)' : `사운드트랙 #${index + 1}`;
};
export const devAudioIncluded = (entry: DevAudioEntry) => !records.get(entry.id)?.disabled;
const refreshMusic = () => soundtrack.setAssetResolver((file, original) => {
  const entry = DEV_AUDIO_CATALOG.find(entry => entry.id === `music:${file}`);
  return entry ? devAudioAsset(entry).url : original;
}, DEV_AUDIO_CATALOG.filter(entry => entry.kind === 'music' && devAudioIncluded(entry)).map(entry => ({ file: entry.id.slice(6), title: devAudioAsset(entry).item?.title ?? entry.title })));
export function initializeDevAudio() {
  return initialized ??= (async () => {
    store = createDevAudioStore(window.indexedDB);
    for (const item of await store.readLibrary()) installLibrary(item);
    for (const record of await store.read()) {
      if (record.id.startsWith('music:extra:') && record.libraryId) appendTrack(record.libraryId);
      const entry = DEV_AUDIO_CATALOG.find(entry => entry.id === record.id);
      if (!entry) continue;
      // Migrate older single-file experiments into the permanent library before dropping their inline bytes.
      if (record.blob) {
        const item: DevAudioLibraryFile = {
          id: `migrated:${record.id}:${record.updated}`, title: record.name ?? entry.title, kind: entry.kind,
          name: record.name ?? 'audio.mp3', blob: record.blob, source: 'upload', duration: 0, added: record.updated,
        };
        await store.saveLibrary(item); installLibrary(item);
        const { blob: _blob, ...rest } = record;
        const migrated = { ...rest, libraryId: item.id };
        await store.save(migrated); records.set(record.id, migrated);
      } else records.set(record.id, record);
    }
    setSoundEffectResolver((cue, file) => {
      const entry = DEV_AUDIO_CATALOG.find(entry => entry.id === `sfx:${cue}`);
      return entry ? devAudioAsset(entry) : file;
    });
    refreshMusic();
  })();
}
export function devAudioAsset(entry: DevAudioEntry, original = false) {
  const record = original ? undefined : records.get(entry.id);
  const item = devAudioLibrary().find(item => item.id === (record?.libraryId ?? originalId(entry)));
  return { url: item?.url ?? entry.url, level: record?.level ?? entry.level, record, item };
}
export function devAudioReferences(id: string) {
  return DEV_AUDIO_CATALOG.filter(entry => devAudioIncluded(entry) && devAudioAsset(entry).item?.id === id);
}
export async function addDevAudioLibrary(file: Blob, name: string, kind: DevAudioKind, source: 'upload' | 'agent', duration: number) {
  await initializeDevAudio();
  const record: DevAudioLibraryFile = { id: crypto.randomUUID(), title: name.replace(/\.[^.]+$/, ''), name, blob: file, kind, source, duration, added: Date.now() };
  await store.saveLibrary(record); installLibrary(record); return record.id;
}
export async function renameDevAudioLibrary(id: string, input: string) {
  await initializeDevAudio();
  const item = library.get(id);
  if (!item) throw new Error('프로젝트 원본의 파일명은 변경할 수 없습니다.');
  const name = input.trim();
  if (!name || name.length > 180 || /[\\/\x00-\x1f\x7f<>:"|?*]/.test(name)) throw new Error('파일명은 경로·특수문자 없이 180자 이하로 입력해주세요.');
  const extension = item.name.match(/\.[^.]+$/)?.[0];
  if (!extension || !name.toLowerCase().endsWith(extension.toLowerCase()) || name.length <= extension.length) throw new Error(`기존 확장자 ${extension ?? ''}를 유지해주세요.`);
  if (devAudioLibrary().some(file => file.id !== id && file.name.toLowerCase() === name.toLowerCase())) throw new Error('같은 파일명이 있습니다. 다른 이름을 입력해주세요.');
  const updated = { ...item, name, title: item.title === item.name.replace(/\.[^.]+$/, '') ? name.replace(/\.[^.]+$/, '') : item.title };
  await store.saveLibrary(updated);
  // Keep identity and URL stable: every assignment still points at the same bytes.
  library.set(id, updated);
}
export async function saveDevAudio(id: string, change: Partial<Pick<DevAudioOverride, 'libraryId' | 'level' | 'disabled'>>) {
  await initializeDevAudio();
  const entry = DEV_AUDIO_CATALOG.find(entry => entry.id === id);
  if (!entry) throw new Error('알 수 없는 사운드입니다.');
  if (change.libraryId) {
    const item = devAudioLibrary().find(item => item.id === change.libraryId);
    if (!item || item.kind !== entry.kind) throw new Error('같은 종류의 라이브러리 사운드를 선택해주세요.');
  }
  if (change.level !== undefined && (!Number.isFinite(change.level) || change.level < 0 || change.level > 1)) throw new Error('음량은 0–100% 범위여야 합니다.');
  const record = { ...records.get(id), ...change, id, updated: Date.now() };
  await store.save(record); records.set(id, record);
  if (id.startsWith('music:')) refreshMusic();
}
export async function resetDevAudio(id?: string) {
  await initializeDevAudio();
  if (id?.startsWith('music:extra:')) { await saveDevAudio(id, { disabled: true }); return; }
  if (id) { await store.remove(id); records.delete(id); }
  else { await store.clear(); records.clear(); }
  if (!id) DEV_AUDIO_CATALOG.splice(0, DEV_AUDIO_CATALOG.length, ...DEV_AUDIO_CATALOG.filter(entry => !entry.id.startsWith('music:extra:')));
  if (!id || id.startsWith('music:')) refreshMusic();
}
export async function deleteDevAudioLibrary(id: string) {
  await initializeDevAudio();
  if (!library.has(id)) throw new Error('프로젝트 원본은 라이브러리에서 삭제할 수 없습니다.');
  const references = [...records.values()].filter(record => record.libraryId === id).map(record => ({ ...record, libraryId: undefined, disabled: record.id.startsWith('music:extra:') ? true : record.disabled }));
  await store.deleteLibrary(id, references);
  for (const record of references) {
    if (record.id.startsWith('music:extra:')) { await store.remove(record.id); records.delete(record.id); const index = DEV_AUDIO_CATALOG.findIndex(entry => entry.id === record.id); if (index >= 0) DEV_AUDIO_CATALOG.splice(index, 1); }
    else records.set(record.id, record);
  }
  const url = urls.get(id); if (url) URL.revokeObjectURL(url); urls.delete(id); library.delete(id);
  if (references.some(record => record.id.startsWith('music:'))) refreshMusic();
}
export async function exportDevAudio() {
  const encode = async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  };
  const files = await Promise.all([...library.values()].map(async ({ blob, ...record }) => ({ ...record, mime: blob.type, data: await encode(blob) })));
  // Resolve all assigned URLs into bytes so project imports can also assign an existing project sound to another event.
  const overrides = await Promise.all([...records.values()].filter(record => !record.id.startsWith('music:extra:')).map(async record => {
    const entry = DEV_AUDIO_CATALOG.find(entry => entry.id === record.id)!;
    const asset = devAudioAsset(entry);
    const blob = record.libraryId ? library.get(record.libraryId)?.blob ?? await (await fetch(asset.url)).blob() : undefined;
    return { ...record, name: asset.item?.name, mime: blob?.type, data: blob ? await encode(blob) : undefined };
  }));
  const musicPlaylist = await Promise.all(DEV_AUDIO_CATALOG.filter(entry => entry.kind === 'music' && devAudioIncluded(entry)).map(async entry => {
    const asset = devAudioAsset(entry);
    return { file: entry.path.split('/').at(-1)!, title: asset.item?.title ?? entry.title,
      ...(entry.id.startsWith('music:extra:') ? { data: await encode(await (await fetch(asset.url)).blob()), name: asset.item?.name } : {}) };
  }));
  return { format: 'speedracer-dev-audio' as const, version: 2, library: files, overrides, musicPlaylist };
}

function appendTrack(libraryId: string) {
  const item = devAudioLibrary().find(item => item.id === libraryId && item.kind === 'music');
  if (!item) return undefined;
  const id = `music:extra:${libraryId}`;
  let entry = DEV_AUDIO_CATALOG.find(entry => entry.id === id);
  if (!entry) {
    entry = { id, title: item.title, kind: 'music', url: item.url, level: .55,
      path: `public/music/ost/library-${libraryId.replace(/[^a-zA-Z0-9-]/g, '-')}.mp3`,
      scene: `사운드트랙 #${DEV_AUDIO_CATALOG.filter(entry => entry.kind === 'music').length}` };
    DEV_AUDIO_CATALOG.push(entry);
  }
  return entry;
}
export async function setDevAudioTrack(libraryId: string, included: boolean) {
  await initializeDevAudio();
  const tracks = DEV_AUDIO_CATALOG.filter(entry => entry.kind === 'music' && entry.scene !== '로비' && devAudioAsset(entry).item?.id === libraryId);
  if (!included) {
    for (const entry of tracks) await saveDevAudio(entry.id, { disabled: true });
  } else {
    const entry = tracks[0] ?? appendTrack(libraryId);
    if (!entry) throw new Error('배경음악 파일을 선택해주세요.');
    await saveDevAudio(entry.id, { libraryId, disabled: false });
  }
}
