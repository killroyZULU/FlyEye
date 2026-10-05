export const MAX_INITIAL_JAVASCRIPT_BYTES = 550_000;
export const MAX_CHUNK_BYTES = 500_000;

export function analyzeBundle(manifest, assets) {
  const entry = manifest['index.html'];
  if (!entry?.isEntry) throw new Error('Production entry is missing from the bundle manifest.');
  const visited = new Set();
  const initialFiles = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk || !assets.has(chunk.file))
      throw new Error('A static bundle dependency is missing.');
    initialFiles.add(chunk.file);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  }
  visit('index.html');
  const initialBytes = [...initialFiles].reduce((sum, file) => sum + assets.get(file).bytes, 0);
  const initialGzipBytes = [...initialFiles].reduce(
    (sum, file) => sum + assets.get(file).gzipBytes,
    0,
  );
  for (const asset of assets.values()) {
    if (asset.bytes > MAX_CHUNK_BYTES) throw new Error('A JavaScript chunk exceeds 500 kB.');
  }
  if (initialBytes > MAX_INITIAL_JAVASCRIPT_BYTES) {
    throw new Error('Initial JavaScript including static dependencies exceeds 550 kB.');
  }
  return { initialFiles: [...initialFiles], initialBytes, initialGzipBytes, chunks: assets.size };
}
