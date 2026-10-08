import { createCatalogTrack } from '../../output/test/game/track/trackRuntime.js';
import { layoutObstacles, mulberry32 } from '../../output/test/game/track/obstacleLayout.js';

/** A catalog track with mine fields forced on: minefields are on hold in the catalog (hazardCatalog), but the generator still works with an explicit option. */
export function minedTrack(definition, challenge) {
  const track = createCatalogTrack(definition, challenge), template = track.heightObstacles[0], options = { mines: true };
  const base = layoutObstacles(track, challenge, mulberry32(Math.round(track.length) + 7), template, undefined, options);
  track.heightObstacles.splice(0, track.heightObstacles.length, ...base.heights);
  Object.assign(track, { corridorObstacles: base.corridors, mineFields: base.mineFields,
    rollObstacleLayout(random) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const next = layoutObstacles(track, challenge, random, template, base.counts, options);
        if (!next.missed) return { heights: next.heights, corridors: next.corridors, pads: next.pads, mineFields: next.mineFields, arcRails: track.arcRails, boostRings: next.rings };
      }
      return { heights: base.heights, corridors: base.corridors, pads: base.pads, mineFields: base.mineFields, arcRails: track.arcRails, boostRings: base.rings };
    } });
  return track;
}
