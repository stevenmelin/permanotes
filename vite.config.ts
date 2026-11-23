import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Writes the list of built files into sw.js so the iPhone web app works offline.
function swManifest() {
  let outDir = 'dist';
  return {
    name: 'pn-sw-manifest',
    configResolved(c: { build: { outDir: string } }) { outDir = c.build.outDir; },
    closeBundle() {
      const files: string[] = [];
      const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p.slice(outDir.length + 1).replace(/\\/g, '/')); } };
      walk(outDir);
      const sw = join(outDir, 'sw.js');
      const src = readFileSync(sw, 'utf8');
      if (!src.includes('__PN_FILES__')) throw new Error('sw.js is missing the __PN_FILES__ placeholder');
      writeFileSync(sw, src.replace('__PN_FILES__', JSON.stringify(files.filter((f) => f !== 'sw.js'))).replace('__PN_VERSION__', `${pkg.version}-${Date.now()}`));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), swManifest()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000, target: 'es2020' },
});
