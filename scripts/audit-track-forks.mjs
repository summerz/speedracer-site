import { auditForks } from './fork-audit-lib.mjs';
const rows = auditForks({ allCraft: process.argv.includes('--all-craft'), holdAfterLock: process.argv.includes('--hold') ? 1.5 : .2 });
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else console.table(rows.map(({ name, routeId, peak, whole, headingRate, lateralG, spacing, failures, runs }) => ({
  track: name, route: routeId.split(':').at(-1), curvature: peak.toFixed(4), whole: whole.toFixed(4), degPerM: (headingRate * 180 / Math.PI).toFixed(2), g80: lateralG.toFixed(1), gap: spacing.toFixed(1), failed: `${failures.length}/${runs.length}`, contacts: Math.max(...runs.map(r => r.collisions + r.exits))
})));

if (rows.some(r => r.failures.length || r.peak > .012)) process.exitCode = 1;
