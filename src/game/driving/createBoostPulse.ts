import * as THREE from 'three';

/** Two reused rings behind the craft; no render targets or particle allocation. */
export function createBoostPulse(drone: THREE.Group, color: string) {
  const geometry = new THREE.TorusGeometry(1, 0.018, 6, 96);
  const rings = [0, 1].map(() => {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; mesh.visible = false; mesh.name = 'boostShockwave';
    drone.add(mesh);
    return mesh;
  });
  let elapsed = 1;
  return {
    trigger() { elapsed = 0; },
    reset() { elapsed = 1; rings.forEach((ring) => { ring.visible = false; }); },
    update(delta: number, reducedMotion: boolean) {
      elapsed += delta;
      rings.forEach((ring, index) => {
        const age = elapsed - index * 0.06;
        ring.visible = !reducedMotion && age >= 0 && age < 0.46;
        if (!ring.visible) return;
        const t = age / 0.46;
        ring.scale.setScalar(1.4 + 13 * (1 - (1 - t) ** 2));
        ring.position.set(0, 0, 2.7 + t * 4.5);
        ring.material.opacity = (1 - t) ** 2 * (index ? 0.45 : 0.85);
      });
    },
    dispose() { rings.forEach((ring) => { ring.removeFromParent(); ring.material.dispose(); }); geometry.dispose(); },
  };
}
