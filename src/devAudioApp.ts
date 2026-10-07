import { menuHeader } from './menuHeader';
import { soundtrack } from './game/audio/soundtrack';
import { DEV_AUDIO_CATALOG, devAudioAsset, saveDevAudio, resetDevAudio, exportDevAudio, initializeDevAudio,
  devAudioLibrary, devAudioReferences, addDevAudioLibrary, deleteDevAudioLibrary, renameDevAudioLibrary, devAudioUsage, devAudioIncluded, setDevAudioTrack, type DevAudioEntry } from './devAudio';
import type { DevAudioKind } from './devAudioStore';
import './devAudio.css';

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const time = (seconds: number) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}` : '—';
const sourceLabel = { project: '프로젝트 원본', upload: '업로드', agent: '에이전트 생성' };

export function mountDevAudio(root: HTMLDivElement, balance: number, initialView: 'assignments' | 'library' = 'assignments') {
  document.title = 'Speedracer · 사운드 관리'; soundtrack.suspend();
  root.innerHTML = `<main class="audio-lab">
    ${menuHeader('sound-lab', balance)}
    <div class="audio-lab-heading"><div><p class="eyebrow">DEVELOPMENT ONLY</p><h1>사운드 관리</h1><p>소리를 보관하고, 들어보고, 게임에 지정하세요.</p></div><div class="audio-lab-actions"><button type="button" data-export>라이브러리·변경분 내보내기</button><label class="audio-lab-upload">보관함 가져오기<input type="file" accept=".json,application/json" data-import></label></div></div>
    <div class="audio-lab-views"><div class="audio-lab-view-buttons" role="group" aria-label="작업 선택"><button type="button" data-view="assignments" aria-pressed="true">게임에 지정</button><button type="button" data-view="library" aria-pressed="false">라이브러리</button></div><aside class="audio-lab-project-guide" aria-label="프로젝트 반영 안내"><p data-project-note></p><div data-project-command hidden><p>변경분을 내보낸 뒤, 프로젝트 폴더의 터미널에서 실행하세요.</p><code>npm run audio:import -- ~/Downloads/speedracer-audio.json</code><small>다운로드 위치가 다르면 경로를 바꾸세요. 프로젝트 반영 후 배포해야 다른 이용자에게 적용됩니다.</small></div></aside></div>
    <div class="audio-lab-workspace">
      <section class="audio-lab-library" aria-label="사운드 목록">
        <div class="audio-lab-tabs" role="group" aria-label="사운드 종류"><button type="button" data-kind="sfx" aria-pressed="true">효과음</button><button type="button" data-kind="music" aria-pressed="false">배경음악</button></div>
        <div class="audio-lab-add"><label class="audio-lab-upload">여러 파일 추가<input type="file" multiple accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" data-upload></label><label>출처 <select data-source aria-label="파일 출처"><option value="upload">업로드</option><option value="agent">에이전트 생성</option></select></label></div>
        <p class="audio-lab-hint" data-upload-hint></p>
        <label class="audio-lab-search">사운드 찾기<input type="search" placeholder="이름 또는 이벤트 검색" aria-label="사운드 찾기"></label>
        <div class="audio-lab-list-tools"><button type="button" data-auto-preview aria-pressed="true">미리듣기 켜짐</button></div><div class="audio-lab-list"></div>
      </section>
      <section class="audio-lab-editor" aria-label="선택 사운드 편집"></section>
    </div>
    <p class="audio-lab-message" role="status" aria-live="polite"></p>
    <footer class="audio-lab-footer"><p>파일과 지정 설정은 이 브라우저에 보관됩니다. 교체·원본 복원으로 파일이 삭제되지 않습니다. 브라우저 데이터 삭제 전에는 보관함을 내보내세요.</p><p>게임 지정은 다음 주행부터 적용됩니다. 개발용 보관함은 배포에 포함되지 않습니다. 엔진·바람·비 등 합성 지속음은 별도 코드로 관리합니다.</p><button type="button" data-reset-all>모든 게임 지정 원본 복원</button></footer>
    <dialog class="audio-lab-confirm"><h2 data-dialog-title></h2><p data-dialog-text></p><div><button type="button" data-cancel>취소</button><button type="button" data-confirm>확인</button></div></dialog>
  </main>`;
  root.querySelector<HTMLElement>('.menu-music')!.hidden = true;
  const controller = new AbortController(), options = { signal: controller.signal };
  const list = root.querySelector<HTMLElement>('.audio-lab-list')!, editor = root.querySelector<HTMLElement>('.audio-lab-editor')!;
  const status = root.querySelector<HTMLElement>('.audio-lab-message')!, search = root.querySelector<HTMLInputElement>('input[type=search]')!;
  const projectGuide = root.querySelector<HTMLElement>('.audio-lab-project-guide')!;
  const renderProjectGuide = () => {
    const hasChanges = devAudioLibrary().some(item => item.source !== 'project') || DEV_AUDIO_CATALOG.some(entry => devAudioAsset(entry).record);
    projectGuide.classList.toggle('has-changes', hasChanges);
    projectGuide.querySelector<HTMLElement>('[data-project-note]')!.textContent = hasChanges
      ? '브라우저에 변경분이 있습니다. 프로젝트 반영은 별도입니다.'
      : '게임 지정과 라이브러리는 이 브라우저에 저장됩니다.';
    projectGuide.querySelector<HTMLElement>('[data-project-command]')!.hidden = !hasChanges;
  };
  const dialog = root.querySelector<HTMLDialogElement>('dialog')!;
  const player = new Audio(); player.preload = 'metadata';
  let selected: DevAudioEntry = DEV_AUDIO_CATALOG.find(entry => entry.id === 'sfx:warning-up')!;
  let libraryId: string | undefined;
  let candidateId: string | undefined, candidateFor: string | undefined;
  let kind: DevAudioKind = 'sfx', view = initialView;
  let autoPreview = true;
  let disposed = false, busy = false, playingOriginal = false, playingId: string | undefined, playToken = 0;
  let validation: AudioContext | undefined, confirmAction: (() => Promise<void>) | undefined;
  const message = (text: string) => { if (!disposed) status.textContent = text; };
  const stop = () => { playToken++; player.pause(); player.removeAttribute('src'); player.load(); playingId = undefined; updateTransport(); };
  const updateTransport = () => {
    if (disposed) return;
    const label = editor.querySelector<HTMLElement>('[data-play-state]');
    if (label) label.textContent = playingId ? `${playingOriginal ? '원본' : '선택 사운드'} 재생 · ${time(player.currentTime)} / ${time(player.duration)}` : '재생 대기';
    list.querySelectorAll<HTMLElement>('[data-audio-id]').forEach(row => row.classList.toggle('is-playing', row.dataset.audioId === playingId));
    editor.querySelectorAll<HTMLElement>('[data-candidate-id]').forEach(row => row.classList.toggle('is-playing', row.dataset.candidateId === playingId));
    const button = editor.querySelector<HTMLButtonElement>('[data-stop]'); if (button) button.disabled = !playingId;
    const seek = editor.querySelector<HTMLInputElement>('[data-seek]');
    if (seek) { seek.disabled = !playingId || !Number.isFinite(player.duration); seek.max = String(Number.isFinite(player.duration) ? player.duration : 1); seek.value = String(player.currentTime); }
  };
  const transport = (original: boolean) => `<div class="audio-lab-transport"><button type="button" class="primary-action" data-play ${busy ? 'disabled' : ''}>${view === 'library' ? '미리 듣기' : '현재 설정 재생'}</button>${original ? `<button type="button" data-original ${busy ? 'disabled' : ''}>원본 재생</button>` : ''}<button type="button" data-stop disabled>정지</button></div><p class="audio-lab-play-state mono" data-play-state>재생 대기</p><input class="audio-lab-seek" type="range" data-seek min="0" max="1" step=".05" value="0" aria-label="재생 위치" disabled><label class="audio-lab-loop"><input type="checkbox" data-loop ${player.loop ? 'checked' : ''}> 반복 재생</label>`;
  const renderList = () => {
    const entries = (view === 'library' ? devAudioLibrary() : DEV_AUDIO_CATALOG).filter(entry => entry.kind === kind && `${entry.title} ${entry.id} ${'name' in entry ? entry.name : devAudioUsage(entry)}`.toLowerCase().includes(search.value.toLowerCase()));
    list.innerHTML = entries.length ? entries.map(entry => {
      const record = view === 'assignments' ? devAudioAsset(entry as DevAudioEntry).record : undefined;
      const badge = view === 'library' && 'source' in entry ? sourceLabel[entry.source] : record ? '시험 설정' : '원본';
      const usage = view === 'library' ? devAudioReferences(entry.id).map(devAudioUsage).join(', ') || '미사용' : devAudioIncluded(entry as DevAudioEntry) ? devAudioUsage(entry as DevAudioEntry) : '사운드트랙 제외';
      const main = 'name' in entry ? entry.name : devAudioUsage(entry as DevAudioEntry);
      const detail = 'name' in entry ? entry.title : devAudioAsset(entry as DevAudioEntry).item?.name ?? entry.title;
      return `<button type="button" class="audio-lab-row" data-audio-id="${escape(entry.id)}" aria-pressed="${entry.id === (view === 'library' ? libraryId : selected.id)}"><span><strong>${escape(main)}</strong><small>${escape(detail)}</small><small class="audio-lab-usage">사용처: ${escape(usage)}</small></span><span class="audio-lab-badge ${record ? 'is-changed' : ''}">${badge}</span></button>`;
    }).join('') : '<p class="audio-lab-empty">일치하는 사운드가 없습니다.</p>';
    root.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.kind === kind)); button.textContent = `${button.dataset.kind === 'music' ? '배경음악' : '효과음'} ${(view === 'library' ? devAudioLibrary() : DEV_AUDIO_CATALOG).filter(entry => entry.kind === button.dataset.kind).length}`; });
    root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    root.querySelector<HTMLElement>('[data-upload-hint]')!.textContent = kind === 'sfx' ? '효과음으로 보관 · 각 3초 이하 / 8MB 이하' : '배경음악으로 보관 · 각 20분 이하 / 32MB 이하';
    const previewToggle = root.querySelector<HTMLButtonElement>('[data-auto-preview]')!;
    previewToggle.parentElement!.hidden = view !== 'library'; previewToggle.setAttribute('aria-pressed', String(autoPreview)); previewToggle.textContent = `미리듣기 ${autoPreview ? '켜짐' : '꺼짐'}`;
    updateTransport();
  };
  const renderEditor = () => {
    const files = devAudioLibrary().filter(item => item.kind === kind);
    if (view === 'library') {
      const item = files.find(item => item.id === libraryId);
      if (!item) { editor.innerHTML = '<p class="audio-lab-empty">보관한 사운드를 선택하세요.</p>'; return; }
      const references = devAudioReferences(item.id);
      const current = devAudioAsset(selected);
      const inPlaylist = references.some(entry => entry.kind === 'music' && entry.scene !== '로비');
      const destinations = DEV_AUDIO_CATALOG.filter(entry => entry.kind === kind).map(entry => {
        const asset = devAudioAsset(entry);
        return `<button type="button" class="audio-lab-row" data-target-id="${escape(entry.id)}" aria-pressed="${selected.id === entry.id}" ${busy ? 'disabled' : ''}><span><strong>${escape(devAudioUsage(entry))}${!devAudioIncluded(entry) ? ' (제외됨)' : ''}</strong><small>${escape(asset.item?.name ?? entry.path.split('/').at(-1)!)}</small></span></button>`;
      }).join('');
      editor.innerHTML = `<p class="eyebrow">${kind === 'sfx' ? 'SOUND EFFECT LIBRARY' : 'MUSIC LIBRARY'}</p><h2>${escape(item.name)}</h2>${item.source !== 'project' ? `<div class="audio-lab-file-actions"><button type="button" data-rename aria-expanded="false" aria-controls="audio-rename-form" ${busy ? 'disabled' : ''}>파일명 변경</button><button type="button" class="audio-lab-delete" data-delete ${busy ? 'disabled' : ''}>파일 삭제</button></div><form id="audio-rename-form" class="audio-lab-rename" hidden><label for="audio-file-name">새 파일명</label><input id="audio-file-name" name="filename" value="${escape(item.name)}" maxlength="180" required autocomplete="off" ${busy ? 'disabled' : ''}><p class="audio-lab-hint">확장자는 유지해주세요. 사용처와 게임 지정은 그대로 유지됩니다.</p><p data-rename-error role="alert" class="audio-lab-rename-error"></p><div class="audio-lab-file-actions"><button type="submit" class="primary-action" ${busy ? 'disabled' : ''}>이름 저장</button><button type="button" data-rename-cancel>취소</button></div></form>` : '<p class="audio-lab-hint">프로젝트 원본 · 복구용으로 보관하며 이름 변경·삭제는 지원하지 않습니다.</p>'}<p class="audio-lab-title">${escape(item.title)}</p><p class="audio-lab-usage">사용처: ${references.length ? references.map(entry => escape(devAudioUsage(entry))).join(', ') : '미사용'}</p><p class="audio-lab-hint">${sourceLabel[item.source]} · ${item.duration ? time(item.duration) : '프로젝트 파일'}${item.size ? ` · ${(item.size / 1024 / 1024).toFixed(2)} MB` : ''}</p>${transport(false)}<div class="audio-lab-replacement"><h3>게임에 지정</h3><p class="audio-lab-hint">사용할 곳을 누르면 현재 지정된 소리를 들어볼 수 있습니다. 비교한 뒤 지정 버튼을 누르세요.</p><div class="audio-lab-candidates" role="group" aria-label="사용할 곳">${destinations}</div><div class="audio-lab-current"><p>현재 사용 파일: <strong data-current-name>${escape(current.item?.name ?? selected.path.split('/').at(-1)!)}</strong></p><p data-current-title>${escape(current.item?.title ?? selected.title)}</p><button type="button" data-current ${busy ? 'disabled' : ''}>현재 사용 사운드 듣기</button></div><button type="button" class="primary-action" data-assign ${busy ? 'disabled' : ''}>선택한 곳에 지정</button><p class="audio-lab-hint">사용처: ${references.length ? references.map(entry => escape(devAudioUsage(entry))).join(', ') : '없음'}</p>${kind === 'music' ? `<div class="audio-lab-playlist"><h3>레이싱 사운드트랙</h3><p class="audio-lab-hint">포함된 곡들을 중복 없이 섞어 재생합니다. 제외해도 파일은 보관됩니다.</p><button type="button" data-playlist="${inPlaylist ? 'remove' : 'add'}" ${busy ? 'disabled' : ''}>${inPlaylist ? '사운드트랙에서 제외' : '사운드트랙에 추가'}</button></div>` : ''}</div>`;
    } else {
      const asset = devAudioAsset(selected);
      if (candidateFor !== selected.id || !files.some(item => item.id === candidateId)) { candidateFor = selected.id; candidateId = asset.item?.id ?? files[0]?.id; }
      const candidates = `<p class="audio-lab-hint">파일을 눌러 바로 들어보세요. 교체 버튼을 누르기 전까지 게임 지정은 유지됩니다.</p><div class="audio-lab-candidates" role="group" aria-label="교체 후보">${files.map(item => `<button type="button" class="audio-lab-row" data-candidate-id="${escape(item.id)}" aria-pressed="${item.id === candidateId}" ${busy ? 'disabled' : ''}><span><strong>${escape(item.name)}</strong><small>${escape(item.title)}</small></span><span class="audio-lab-badge">${item.id === asset.item?.id ? '현재 사용' : sourceLabel[item.source]}</span></button>`).join('')}</div><p data-candidate-label>교체 후보: ${escape(files.find(item => item.id === candidateId)?.name ?? '없음')}</p>`;
      editor.innerHTML = `<p class="eyebrow">${kind === 'sfx' ? 'SOUND EFFECT' : 'SOUNDTRACK'}</p><h2>${escape(devAudioUsage(selected))}</h2><p class="audio-lab-id mono">${escape(selected.id)}</p>${transport(true)}${kind === 'sfx' ? `<label class="audio-lab-level">게임 적용 음량 <output>${Math.round(asset.level * 100)}%</output><input type="range" data-level min="0" max="100" step="1" value="${Math.round(asset.level * 100)}" aria-label="게임 적용 음량" ${busy ? 'disabled' : ''}></label>` : '<p class="audio-lab-hint">시험 재생 음량 55% · 게임에서는 음악 설정을 따릅니다.</p>'}<div class="audio-lab-replacement"><h3>라이브러리에서 교체</h3><p>${escape(asset.item?.name ?? selected.path.split('/').at(-1)!)} · ${escape(asset.item?.title ?? selected.title)}</p>${candidates}<div class="audio-lab-actions"><button type="button" data-candidate ${busy ? 'disabled' : ''}>후보 미리 듣기</button><button type="button" class="primary-action" data-apply ${busy ? 'disabled' : ''}>이 사운드로 교체</button></div><p class="audio-lab-hint">다른 파일을 지정해도 이전 파일은 라이브러리에 남습니다.</p><button type="button" data-reset ${!asset.record || busy ? 'disabled' : ''}>이 사운드 원본 복원</button></div><details class="audio-lab-details"><summary>프로젝트에 반영하는 방법</summary><p>보관함·변경분을 내보낸 뒤 프로젝트 폴더에서 실행하세요. 미사용 후보도 별도로 보관합니다.</p><code>npm run audio:import -- /경로/speedracer-audio.json</code><p class="mono">${escape(selected.path)}</p><p>복귀·반 랩은 고도 변경·랩과 원본 파일을 공유합니다. 서로 다른 파일을 지정하면 프로젝트 반영 시 충돌을 알려줍니다.</p></details>`;
    }
    updateTransport();
  };
  const render = () => { renderList(); renderEditor(); renderProjectGuide(); };
  const playUrl = (url: string, level: number, id: string, original = false) => {
    stop(); playingOriginal = original; player.src = url; player.volume = level; playingId = id;
    const token = ++playToken;
    void player.play().catch(() => { if (token === playToken && !disposed) { stop(); message('파일을 재생하지 못했습니다. 다른 형식을 시도해주세요.'); } }); updateTransport();
  };
  const play = (original: boolean) => {
    if (view === 'library') { const item = devAudioLibrary().find(item => item.id === libraryId); if (item) playUrl(item.url, kind === 'music' ? .55 : .4, item.id); }
    else { const asset = devAudioAsset(selected, original); playUrl(asset.url, asset.level, selected.id, original); }
  };
  const mutate = async (action: () => Promise<void>, success = '저장했습니다. 다음 주행부터 적용됩니다.') => {
    if (busy) return; busy = true; stop(); renderEditor();
    root.querySelectorAll<HTMLInputElement>('input[type=file]').forEach(input => input.disabled = true);
    try { await action(); message(success); } catch (error) { message(error instanceof Error ? error.message : '저장하지 못했습니다.'); }
    finally { busy = false; if (!disposed) { root.querySelectorAll<HTMLInputElement>('input[type=file]').forEach(input => input.disabled = false); render(); } }
  };
  const validateFile = async (file: File, fileKind: DevAudioKind): Promise<number> => {
    if (!/\.(mp3|wav|ogg|m4a|flac)$/i.test(file.name)) throw new Error('지원하는 오디오 파일을 선택해주세요.');
    if (!file.size || file.size > (fileKind === 'sfx' ? 8 : 32) * 1024 * 1024) throw new Error('파일이 비어 있거나 허용 용량을 초과했습니다.');
    if (fileKind === 'sfx') {
      validation ??= new AudioContext(); let buffer: AudioBuffer;
      try { buffer = await validation.decodeAudioData(await file.arrayBuffer()); } catch { throw new Error('오디오를 해석하지 못했습니다. MP3 또는 WAV로 변환해주세요.'); }
      if (buffer.duration <= 0 || buffer.duration > 3) throw new Error('효과음은 3초 이하로 잘라주세요.');
      let peak = 0; for (let channel = 0; channel < buffer.numberOfChannels; channel++) for (const value of buffer.getChannelData(channel)) { if (!Number.isFinite(value)) throw new Error('손상된 오디오입니다.'); peak = Math.max(peak, Math.abs(value)); }
      if (peak < .0001) throw new Error('소리가 없는 파일입니다.'); return buffer.duration;
    }
    const media = new Audio(), url = URL.createObjectURL(file);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('음악 정보를 읽는 시간이 초과됐습니다.')), 10000);
        media.onloadedmetadata = () => { clearTimeout(timer); resolve(); }; media.onerror = () => { clearTimeout(timer); reject(new Error('손상되거나 지원하지 않는 음악입니다.')); };
        media.preload = 'metadata'; media.src = url; media.load();
      });
      if (!Number.isFinite(media.duration) || media.duration <= 0 || media.duration > 1200) throw new Error('음악은 20분 이하로 선택해주세요.'); return media.duration;
    } finally { media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); }
  };
  const confirm = (title: string, text: string, action: () => Promise<void>) => {
    dialog.querySelector('[data-dialog-title]')!.textContent = title; dialog.querySelector('[data-dialog-text]')!.textContent = text; confirmAction = action; dialog.showModal();
  };
  root.addEventListener('click', event => {
    const target = (event.target as Element).closest<HTMLElement>('button'); if (!target || target.matches(':disabled') || busy) return;
    if (target.dataset.audioId) {
      stop();
      if (view === 'library') {
        libraryId = target.dataset.audioId;
        list.querySelectorAll<HTMLElement>('[data-audio-id]').forEach(row => row.setAttribute('aria-pressed', String(row.dataset.audioId === libraryId)));
        renderEditor(); if (autoPreview) play(false);
      } else { selected = DEV_AUDIO_CATALOG.find(entry => entry.id === target.dataset.audioId)!; render(); }
    }
    else if (target.dataset.view) { if (target.dataset.view !== view) location.hash = `sound-lab?view=${target.dataset.view}`; }
    else if (target.dataset.kind) {
      stop(); kind = target.dataset.kind as DevAudioKind; search.value = '';
      if (selected.kind !== kind) selected = DEV_AUDIO_CATALOG.find(entry => entry.kind === kind)!;
      if (!devAudioLibrary().some(item => item.id === libraryId && item.kind === kind)) libraryId = devAudioLibrary().find(item => item.kind === kind)?.id;
      render();
    } else if (target.hasAttribute('data-auto-preview')) { autoPreview = !autoPreview; if (!autoPreview) stop(); renderList(); }
    else if (target.hasAttribute('data-play')) play(false);
    else if (target.hasAttribute('data-current')) { const asset = devAudioAsset(selected); playUrl(asset.url, asset.level, selected.id); }
    else if (target.hasAttribute('data-playlist')) void mutate(() => setDevAudioTrack(libraryId!, target.dataset.playlist === 'add'), target.dataset.playlist === 'add' ? '레이싱 사운드트랙에 추가했습니다.' : '사운드트랙에서 제외했습니다. 파일은 라이브러리에 남습니다.');
    else if (target.hasAttribute('data-original')) play(true);
    else if (target.hasAttribute('data-stop')) stop();
    else if (target.dataset.candidateId || target.hasAttribute('data-candidate')) {
      if (target.dataset.candidateId) candidateId = target.dataset.candidateId;
      const item = devAudioLibrary().find(item => item.id === candidateId);
      if (item) {
        editor.querySelectorAll<HTMLElement>('[data-candidate-id]').forEach(row => row.setAttribute('aria-pressed', String(row.dataset.candidateId === candidateId)));
        editor.querySelector<HTMLElement>('[data-candidate-label]')!.textContent = `교체 후보: ${item.name}`;
        playUrl(item.url, devAudioAsset(selected).level, item.id);
      }
    }
    else if (target.hasAttribute('data-apply') && candidateId) void mutate(() => saveDevAudio(selected.id, { libraryId: candidateId, disabled: false }));
    else if (target.dataset.targetId) {
      stop(); selected = DEV_AUDIO_CATALOG.find(entry => entry.id === target.dataset.targetId)!;
      const asset = devAudioAsset(selected);
      editor.querySelectorAll<HTMLElement>('[data-target-id]').forEach(row => row.setAttribute('aria-pressed', String(row.dataset.targetId === selected.id)));
      editor.querySelector<HTMLElement>('[data-current-name]')!.textContent = asset.item?.name ?? selected.path.split('/').at(-1)!;
      editor.querySelector<HTMLElement>('[data-current-title]')!.textContent = asset.item?.title ?? selected.title;
      if (autoPreview) playUrl(asset.url, asset.level, selected.id);
    }
    else if (target.hasAttribute('data-assign')) void mutate(() => saveDevAudio(selected.id, { libraryId, disabled: false }));
    else if (target.hasAttribute('data-reset')) void mutate(() => resetDevAudio(selected.id), '원본으로 복원했습니다. 보관함 파일은 유지됩니다.');
    else if (target.hasAttribute('data-reset-all')) confirm('모든 게임 지정을 원본으로 복원할까요?', '보관함 파일은 유지하고 게임 지정과 시험 음량만 복원합니다.', () => resetDevAudio());
    else if (target.hasAttribute('data-rename') || target.hasAttribute('data-rename-cancel')) {
      const form = editor.querySelector<HTMLFormElement>('.audio-lab-rename')!;
      const open = target.hasAttribute('data-rename') && form.hidden;
      form.hidden = !open;
      editor.querySelector('[data-rename]')!.setAttribute('aria-expanded', String(open));
      if (open) { const input = form.querySelector<HTMLInputElement>('input')!; input.focus(); input.setSelectionRange(0, input.value.lastIndexOf('.')); }
      else editor.querySelector<HTMLButtonElement>('[data-rename]')!.focus();
    }
    else if (target.hasAttribute('data-delete')) {
      const id = libraryId!, item = devAudioLibrary().find(item => item.id === id)!; const references = devAudioReferences(id);
      confirm(`“${item.name}”을 삭제할까요?`, references.length ? `${references.map(devAudioUsage).join(', ')}에서 사용 중입니다. 삭제하면 기본 사용처는 원본으로 복원하고, 추가 사운드트랙에서는 제거합니다.` : '이 파일을 보관함에서 삭제합니다. 다시 사용하려면 업로드해야 합니다.', async () => { await deleteDevAudioLibrary(id); libraryId = devAudioLibrary().find(item => item.kind === kind)?.id; });
    } else if (target.hasAttribute('data-cancel')) { confirmAction = undefined; dialog.close(); }
    else if (target.hasAttribute('data-confirm')) { const action = confirmAction; confirmAction = undefined; dialog.close(); if (action) void mutate(action, '완료했습니다.'); }
    else if (target.hasAttribute('data-export')) {
      void exportDevAudio().then(data => {
        if (disposed) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'speedracer-audio.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); message('보관함 전체와 게임 지정을 내보냈습니다.');
      }).catch(() => message('내보내지 못했습니다.'));
    } else if (target.id === 'shop-back') location.hash = '';
    else if (target.id === 'open-shop') location.hash = 'shop';
  }, options);
  root.addEventListener('submit', event => {
    const form = event.target as HTMLFormElement;
    if (!form.matches('.audio-lab-rename')) return;
    event.preventDefault(); if (busy || !libraryId) return;
    const id = libraryId, name = form.querySelector<HTMLInputElement>('input')!.value;
    let errorText = '';
    void mutate(async () => {
      try { await renameDevAudioLibrary(id, name); }
      catch (error) { errorText = error instanceof Error ? error.message : '파일명을 변경하지 못했습니다.'; throw error; }
    }, '파일명을 변경했습니다. 게임 지정은 유지됩니다.').then(() => {
      if (disposed || view !== 'library' || libraryId !== id) return;
      const button = editor.querySelector<HTMLButtonElement>('[data-rename]')!;
      if (!errorText) { button.focus(); return; }
      const retry = editor.querySelector<HTMLFormElement>('.audio-lab-rename')!;
      retry.hidden = false; button.setAttribute('aria-expanded', 'true');
      const input = retry.querySelector<HTMLInputElement>('input')!; input.value = name;
      retry.querySelector('[data-rename-error]')!.textContent = errorText; input.focus();
    });
  }, options);
  search.addEventListener('input', renderList, options);
  root.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    if (input.hasAttribute('data-level')) { editor.querySelector('output')!.textContent = `${input.value}%`; if (playingId && !playingOriginal) player.volume = Number(input.value) / 100; }
    else if (input.hasAttribute('data-seek') && playingId) player.currentTime = Number(input.value);
  }, options);
  root.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (input.hasAttribute('data-loop')) player.loop = input.checked;
    else if (input.hasAttribute('data-level')) { const level = Number(input.value) / 100; void mutate(() => saveDevAudio(selected.id, { level })); }
    else if (input.hasAttribute('data-upload') && input.files?.length) {
      const files = [...input.files], fileKind = kind, source = root.querySelector<HTMLSelectElement>('[data-source]')!.value as 'upload' | 'agent'; input.value = '';
      void mutate(async () => {
        let saved = 0; const failures: string[] = [];
        for (const file of files) {
          if (disposed) break;
          message(`검사 중 ${saved + failures.length + 1}/${files.length} · ${file.name}`);
          try { const duration = await validateFile(file, fileKind); if (disposed) break; libraryId = await addDevAudioLibrary(file, file.name, fileKind, source, duration); saved++; }
          catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : '저장 실패'}`); }
        }
        view = 'library'; kind = fileKind; search.value = '';
        if (failures.length) throw new Error(`${saved}개 보관했습니다. ${failures.join(' / ')}`);
      }, `${files.length}개를 보관했습니다. 사용할 곳을 선택해 지정하세요.`);
    } else if (input.hasAttribute('data-import') && input.files?.[0]) {
      const file = input.files[0]; input.value = '';
      void mutate(async () => {
        if (file.size > 150 * 1024 * 1024) throw new Error('보관함 파일은 150MB 이하로 선택해주세요.');
        const data = JSON.parse(await file.text());
        if (data.format !== 'speedracer-dev-audio' || data.version !== 2 || !Array.isArray(data.library)) throw new Error('사운드 관리에서 내보낸 보관함을 선택해주세요.');
        let count = 0;
        for (const item of data.library) {
          if (disposed) break;
          if (!item || !['sfx', 'music'].includes(item.kind) || typeof item.name !== 'string' || typeof item.data !== 'string') throw new Error('보관함 파일 정보가 올바르지 않습니다.');
          const bytes = Uint8Array.from(atob(item.data), char => char.charCodeAt(0));
          const audio = new File([bytes], item.name, { type: typeof item.mime === 'string' ? item.mime : '' });
          const duration = await validateFile(audio, item.kind); if (disposed) break;
          libraryId = await addDevAudioLibrary(audio, audio.name, item.kind, item.source === 'agent' ? 'agent' : 'upload', duration); kind = item.kind; count++;
        }
        view = 'library'; search.value = ''; if (selected.kind !== kind) selected = DEV_AUDIO_CATALOG.find(entry => entry.kind === kind)!;
        message(`${count}개를 가져왔습니다.`);
      }, '보관함 파일을 추가했습니다. 기존 파일과 게임 지정은 유지됩니다.');
    }
  }, options);
  for (const event of ['timeupdate', 'loadedmetadata']) player.addEventListener(event, updateTransport, options);
  player.addEventListener('ended', () => { playingId = undefined; updateTransport(); }, options);
  player.addEventListener('error', () => { if (playingId) { stop(); message('파일을 재생하지 못했습니다. 다른 형식을 시도해주세요.'); } }, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); }, options);
  window.addEventListener('speedracer:menu-back', event => { event.preventDefault(); if (dialog.open) dialog.close(); else location.hash = 'shop'; }, options);
  render(); void initializeDevAudio().then(() => { if (!disposed) renderProjectGuide(); }).catch(() => message('브라우저 저장을 사용할 수 없습니다. 원본 재생만 가능합니다.'));
  return () => { stop(); disposed = true; controller.abort(); if (validation) void validation.close().catch(() => {}); root.replaceChildren(); };
}
