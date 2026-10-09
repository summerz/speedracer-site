import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './overdrivePreview.css';
import { createRacingDrone } from '../game/drone/createRacingDrone';
import { createOverdriveEffect } from '../game/drone/createOverdriveEffect';
import { DRONE_CATALOG } from '../game/drone/droneCatalog';

const features: Record<string, string> = {
  vanguard: '후방 안정익 전개 · 이중 에너지 핀',
  needle: '긴 가변 날개 전개 · 백색 코어',
  hammerhead: '전방 장갑 확장 · 네 갈래 에너지 핀',
  catamaran: '양쪽 선체에 에너지 레일 · 바깥 날개 전개',
  halo: '이중 에너지 링 확장 · 보조 날개 전개',
};

function startPreview() {
  const main = document.querySelector<HTMLElement>('#preview')!;
  main.innerHTML = `<header><div><p class="eyebrow">SPEEDRACER / FLIGHT LAB 01</p>
    <h1>코어 각성 · 기체별 변신</h1><p>같은 힘, 다섯 가지 실루엣.<br>원래 기체의 특징을 살린 전개 부품과 에너지 효과를 비교합니다.</p></div>
    <div class="metric">+5%<small>목표: 2단 부스트 최고속도 기준</small></div></header>
    <nav class="toolbar" aria-label="미리보기 설정"><div class="choices" id="crafts">
    <button data-variant="all" aria-pressed="true">전체 비교</button>
    ${DRONE_CATALOG.map(c => `<button data-variant="${c.configuration.modelVariant}" aria-pressed="false">${c.name}</button>`).join('')}</div>
    <div class="toggles"><button id="rear" aria-pressed="false">후면 보기</button>
    <button id="pin" aria-pressed="true">각성 상태 고정</button><button id="play">5초 변신 재생</button></div></nav>
    <div class="stage" aria-label="기본 기체와 각성 기체의 3D 비교"><div class="labels"></div></div>
    <footer><span>외형 미리보기 · 아이템 / 자율 주행 연결 전</span><span id="status" role="status">각성 상태 고정</span></footer>`;
  const stage = main.querySelector<HTMLElement>('.stage')!;
  const labels = main.querySelector<HTMLElement>('.labels')!;
  const status = main.querySelector<HTMLElement>('#status')!;
  const pin = main.querySelector<HTMLButtonElement>('#pin')!;
  const rearButton = main.querySelector<HTMLButtonElement>('#rear')!;
  const play = main.querySelector<HTMLButtonElement>('#play')!;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101a23');
  const camera = new THREE.OrthographicCamera(-10, 10, 7, -7, .1, 100);
  camera.position.set(0, 0, 30);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  stage.prepend(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xd7f2ff, 0x293a44, 2.4));
  const key = new THREE.DirectionalLight(0xe5f4ff, 4.5);
  key.position.set(-4, 8, 12); scene.add(key);
  const rim = new THREE.DirectionalLight(0x64bfbe, 1.5);
  rim.position.set(5, 1, -5); scene.add(rim);
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .45, .25, 1.1);
  const output = new OutputPass();
  composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(output);

  const views = DRONE_CATALOG.flatMap(craft => [false, true].map(awake => {
    const drone = createRacingDrone({ variant: craft.configuration.modelVariant });
    const effect = awake ? createOverdriveEffect(drone, craft.lineColor) : null;
    scene.add(drone);
    return { craft, awake, drone, effect };
  }));
  let selected = 'all', rear = false, pinned = true, elapsed: number | null = null;
  let ordered = views;
  let layoutKey = '';
  const mobileQuery = window.matchMedia('(max-width:700px)');
  const motionQuery = window.matchMedia('(prefers-reduced-motion:reduce)');
  const layout = () => {
    const mobile = mobileQuery.matches, detail = selected !== 'all';
    main.classList.toggle('detail', detail);
    ordered = detail ? views.filter(v => v.craft.configuration.modelVariant === selected)
      : mobile ? views : [...views.filter(v => !v.awake), ...views.filter(v => v.awake)];
    const cols = detail ? (mobile ? 1 : 2) : (mobile ? 2 : 5);
    const rows = detail ? (mobile ? 2 : 1) : (mobile ? 5 : 2);
    const width = stage.clientWidth, height = stage.clientHeight;
    const cellHeight = detail ? 8.6 : mobile ? 7.3 : 6.4;
    const worldHeight = rows * cellHeight, worldWidth = worldHeight * width / height;
    camera.left = -worldWidth / 2; camera.right = worldWidth / 2;
    camera.top = worldHeight / 2; camera.bottom = -worldHeight / 2; camera.updateProjectionMatrix();
    renderer.setSize(width, height); composer.setSize(width, height);
    views.forEach(v => { v.drone.visible = ordered.includes(v); });
    ordered.forEach((v, i) => {
      const cellWidth = worldWidth / cols;
      const scale = detail ? Math.min(1.45, cellWidth / 6.4) : Math.min(.94, cellWidth / 4.8);
      v.drone.scale.setScalar(scale);
      v.drone.rotation.set(.66, rear ? .48 : Math.PI + .48, 0);
      v.drone.position.set((i % cols + .5) * cellWidth - worldWidth / 2,
        worldHeight / 2 - (Math.floor(i / cols) + .5) * cellHeight - .25, 0);
    });
    const nextKey = `${mobile}/${selected}`;
    if (layoutKey !== nextKey) {
      labels.innerHTML = ordered.map(v => `<article class="cell ${v.awake ? 'awake' : ''}">
        <div class="state">${v.awake ? '02 / CORE AWAKENING' : '01 / STANDARD'}</div><h2>${v.craft.name}</h2>
        <p>${v.awake ? features[v.craft.configuration.modelVariant] : v.craft.role + ' · 기존 외형'}</p></article>`).join('');
      layoutKey = nextKey;
    }
  };
  const observer = new ResizeObserver(layout); observer.observe(stage);
  main.querySelector('#crafts')!.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-variant]');
    if (!button) return;
    selected = button.dataset.variant!;
    main.querySelectorAll<HTMLButtonElement>('[data-variant]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    layout();
  });
  rearButton.addEventListener('click', () => {
    rear = !rear; rearButton.setAttribute('aria-pressed', String(rear));
    rearButton.textContent = rear ? '정면 보기' : '후면 보기'; layout();
  });
  pin.addEventListener('click', () => {
    pinned = !pinned; elapsed = null; pin.setAttribute('aria-pressed', String(pinned));
    status.textContent = pinned ? '각성 상태 고정' : '기본 상태';
    play.textContent = '5초 변신 재생';
  });
  play.addEventListener('click', () => {
    pinned = false; pin.setAttribute('aria-pressed', 'false'); elapsed = 0;
    play.textContent = '처음부터 재생'; status.textContent = '코어 점화 → 부품 전개 → 각성 → 해제';
  });
  let frame = 0, previous = 0, stopped = false;
  const animate = (now: number) => {
    if (stopped) return;
    const delta = previous ? Math.min((now - previous) / 1000, .05) : 0;
    previous = now;
    let strength = pinned ? 1 : 0;
    if (elapsed !== null) {
      elapsed += delta;
      strength = Math.min(1, elapsed / .6, Math.max(0, (6.2 - elapsed) / .6));
      strength = THREE.MathUtils.smoothstep(strength, 0, 1);
      if (elapsed >= 6.2) { elapsed = null; play.textContent = '5초 변신 재생'; status.textContent = '해제 완료 · 기본 상태'; }
    }
    views.forEach(v => { v.effect?.setStrength(strength); v.effect?.update(delta, motionQuery.matches); });
    composer.render(); frame = requestAnimationFrame(animate);
  };
  const visibility = () => {
    cancelAnimationFrame(frame); previous = 0;
    if (!document.hidden && !stopped) frame = requestAnimationFrame(animate);
  };
  document.addEventListener('visibilitychange', visibility);
  const contextLost = (event: Event) => {
    event.preventDefault(); stopped = true; cancelAnimationFrame(frame);
    status.textContent = '렌더링이 중단되었습니다. 페이지를 새로고침해 주세요.';
  };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  layout(); frame = requestAnimationFrame(animate);
  const dispose = () => {
    stopped = true; cancelAnimationFrame(frame); observer.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    views.forEach(v => {
      v.effect?.dispose();
      v.drone.traverse(object => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry);
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m));
        }
      });
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    bloom.dispose(); output.dispose(); composer.dispose(); renderer.dispose();
  };
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}

try { startPreview(); }
catch (error) {
  document.querySelector('#preview')!.innerHTML = '<p class="error" role="alert">3D 미리보기를 열 수 없습니다. WebGL을 지원하는 브라우저에서 다시 열어 주세요.</p>';
  console.error(error);
}
