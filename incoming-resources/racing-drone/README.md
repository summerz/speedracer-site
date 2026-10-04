# Racing Drone — player craft (three.js)

## Run
Any static server (ES modules + import map need http, not file://):

    npx serve .          # or: python3 -m http.server 8080
    open http://localhost:3000/index.html

three.js r184 is pinned via the import map in index.html — no install step.

## Files
- `src/createRacingDrone.ts` — the reusable craft module (TypeScript source).
- `createRacingDrone.js` — same module, types stripped; what the preview imports.
- `index.html` — preview scene: dark hangar, grid, orbit / cockpit cameras, threshold bloom, thruster slider, OBJ/GLB export.
- `three-d-stage.js` — viewer shell (renderer, controls, exporter). Scene-only; nothing of the craft lives here.
- `screenshots/` — ¾ external and cockpit captures.

## API
    import { createRacingDrone, setThrusterIntensity } from './createRacingDrone.js';
    const drone = createRacingDrone({ accentColor: 0xb04dff });  // THREE.Group
    scene.add(drone);
    setThrusterIntensity(drone, 2.0);           // 0 = cold, 1 = idle, >1 = boost
    drone.getObjectByName('cockpitCameraMount') // attach cockpit camera here
    drone.getObjectByName('chaseCameraTarget')  // orbit / chase look-at
    drone.getObjectByName('thrusterLeft' | 'thrusterRight') // particle / trail anchors

Y up, -Z forward, length 3.85 units (z -2.1 … 1.75), span 2.9, height 0.9.

## Structure (7 draw calls)
body (hull + 2 nacelles + fin, 1 mesh) · frame (pylons + seat + dash housing) · canopy (glass) ·
neonTeal (identity line ×2, canopy rails ×2, nacelle collars, fin edge, instrument panel) ·
thrusterRings (accent) · thrusterCores (accent, intensity-driven).

## Tuning knobs
- `DroneOptions`: bodyColor, frameColor, glassColor, neonColor, accentColor, neonBoost, thrusterIntensity.
- Hull silhouette: `hullSections` (z, half-width, top, bottom, centre-y). Nacelles: `octSection` radii and `NX/NY`.
- Identity neon path: the `identity` point list (mirrored automatically).
- Bloom: neon materials are authored above 1.0 (`neonBoost`); any threshold bloom at 1.0 picks up only the lines.
