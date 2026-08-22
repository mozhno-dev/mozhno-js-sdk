// Adds explicit .js extensions to relative imports in generated .d.ts files,
// required by consumers using "moduleResolution": "node16"/"nodenext" (TS2834).
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const distDir = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (full.endsWith('.d.ts')) patch(full);
  }
}

function patch(file) {
  const content = readFileSync(file, 'utf8');
  const patched = content.replace(
    /(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g,
    (m, prefix, path, suffix) => {
      if (/\.(js|mjs|cjs|json)$/.test(path)) return m;
      return `${prefix}${path}.js${suffix}`;
    },
  );
  if (patched !== content) {
    writeFileSync(file, patched);
    console.log(`patched ${file}`);
  }
}

walk(distDir);
