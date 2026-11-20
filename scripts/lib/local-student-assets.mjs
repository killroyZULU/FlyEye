import { readFile } from 'node:fs/promises';
import { studentOrigin, tokenClaims } from './local-student-router.mjs';

export async function buildPublicAssets(anon) {
  if (tokenClaims(anon)?.role !== 'anon') throw new Error('Invalid public key.');
  const { build } = await import('vite');
  const bundle = await build({
    envDir: false,
    publicDir: false,
    configLoader: 'native',
    logLevel: 'silent',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(studentOrigin),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(anon),
    },
    build: { write: false, manifest: false, sourcemap: false },
  });
  const assets = new Map();
  for (const output of [bundle].flat()) {
    for (const item of output.output) {
      if (item.fileName === 'index.html')
        assets.set('/', { bytes: item.source, type: 'text/html; charset=utf-8' });
      else if (/^assets\/[\w-]+\.(js|css)$/.test(item.fileName)) {
        assets.set('/' + item.fileName, {
          bytes: item.type === 'chunk' ? item.code : item.source,
          type: item.fileName.endsWith('.js') ? 'text/javascript' : 'text/css',
        });
      } else throw new Error('Unexpected frontend asset.');
    }
  }
  for (const name of ['archivo-latin-600-700.woff2', 'ibm-plex-sans-latin-400-600.woff2']) {
    assets.set('/fonts/' + name, {
      bytes: await readFile(new URL('../../public/fonts/' + name, import.meta.url)),
      type: 'font/woff2',
    });
  }
  if (!assets.has('/')) throw new Error('Missing frontend.');
  return assets;
}
