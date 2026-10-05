import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { analyzeBundle } from './lib/bundle-budget.mjs';

const root = path.resolve(process.argv[2] ?? 'dist');
const manifest = JSON.parse(await fs.readFile(path.join(root, '.vite/manifest.json'), 'utf8'));
const assets = new Map();
for (const entry of await fs.readdir(path.join(root, 'assets'))) {
  if (!entry.endsWith('.js')) continue;
  const content = await fs.readFile(path.join(root, 'assets', entry));
  assets.set(`assets/${entry}`, { bytes: content.length, gzipBytes: gzipSync(content).length });
}
const result = analyzeBundle(manifest, assets);
console.log(
  `Bundle budget passed: initial JavaScript ${(result.initialBytes / 1000).toFixed(2)} kB / ${(result.initialGzipBytes / 1000).toFixed(2)} kB gzip across ${result.initialFiles.length} static files; ${result.chunks} chunks, each below 500 kB.`,
);
