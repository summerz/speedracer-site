import { pathToFileURL } from 'node:url';
import { CatmullRomCurve3 } from 'three';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { authorClosedTrack } from '../output/test/game/track/trackAuthoring.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';

/** Measure generated geometry, rather than assuming recipe values reach the road. */
export function measureLayout(definition) {
  const layout = definition.layout, track = createCatalogTrack(definition);
  const backbone = new CatmullRomCurve3(authorClosedTrack({ ...layout, stunts: [] }).map(p => p.position), true, 'centripetal');
  backbone.arcLengthDivisions = 8192;
  const sections = track.sections.filter(s => s.kind !== 'course');
  const stunts = layout.stunts.map((stunt, index) => {
    const section = sections[index];
    if (!section || section.kind !== (stunt.kind === 'loop' ? 'vertical-loop' : 'helix')) throw new Error(`${definition.id}: missing stunt ${index}`);
    let count = 0, inverted = 0, minHeight = Infinity, maxHeight = -Infinity;
    for (let d = section.start; d <= section.end; d += 2) {
      const frame = track.sample(d);
      count++; if (frame.up.y < 0) inverted++;
      minHeight = Math.min(minHeight, frame.position.y); maxHeight = Math.max(maxHeight, frame.position.y);
    }
    return { kind: stunt.kind, radius: stunt.radius, turns: stunt.turns, span: stunt.span,
      backboneMetres: backbone.getLength() * stunt.span, metres: section.end - section.start,
      heightRange: maxHeight - minHeight, invertedFraction: inverted / count,
      rise: track.sample(section.end).position.y - track.sample(section.start).position.y };
  });
  return { id: definition.id, length: track.length, routes: (track.branches ?? []).flatMap(f => f.routes).length, stunts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(TRACK_CATALOG.filter(t => ['abyss','kelp','coral','lagoon'].includes(t.district)).map(measureLayout), null, 2));
}
