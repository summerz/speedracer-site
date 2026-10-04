import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import packageInfo from './package.json' with { type: 'json' };

const { version } = packageInfo;
const hash = content => createHash('sha256').update(content).digest('hex');
export default defineConfig({
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  plugins: [{
    name: 'speedracer-app-shell',
    transformIndexHtml(html) { return html.replaceAll('__APP_VERSION__', version); },
    closeBundle() {
      const walk = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const name = prefix + entry.name;
        return entry.isDirectory() ? walk(join(dir, entry.name), name + '/') : [name];
      });
      const assets = walk('dist').filter(name => name !== 'sw.js' && name !== 'CNAME').sort()
        .map(name => ({ url: '/' + name, sha256: hash(readFileSync(join('dist', name))) }));
      const shell = { version, generation: hash(JSON.stringify(assets)).slice(0, 20), assets };
      const source = readFileSync('scripts/service-worker.js', 'utf8');
      writeFileSync('dist/sw.js', `const SHELL = ${JSON.stringify(shell)};\n${source}`);
    },
  }],
});
