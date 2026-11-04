import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

export function isLocalIssuerPath(value) {
  return (
    typeof value === 'string' &&
    path.isAbsolute(value) &&
    !/^[\\/]{2}/.test(value) &&
    (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(value))
  );
}

export async function readIssuerFile(file, maximum = 65536) {
  if (!isLocalIssuerPath(file)) throw new Error('Local absolute issuer path required.');
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum)
    throw new Error('Invalid issuer file.');
  const bytes = await readFile(file);
  if (bytes.length > maximum) throw new Error('Invalid issuer file.');
  return bytes;
}

// Read only Git metadata before preflight; do not launch Git to discover HEAD.
export async function readIssuerRevision(root) {
  if (!isLocalIssuerPath(root)) throw new Error('Local absolute issuer path required.');
  const marker = path.join(root, '.git');
  const markerStat = await lstat(marker);
  if (markerStat.isSymbolicLink()) throw new Error('Invalid Git metadata.');
  let gitDir = marker;
  if (!markerStat.isDirectory()) {
    const pointer = (await readIssuerFile(marker)).toString().trim();
    if (!pointer.startsWith('gitdir: ')) throw new Error('Invalid Git metadata.');
    gitDir = path.resolve(root, pointer.slice(8));
  }
  const head = (await readIssuerFile(path.join(gitDir, 'HEAD'))).toString().trim();
  if (/^[a-f0-9]{40}$/.test(head)) return head;
  if (!/^ref: refs\/heads\/[a-zA-Z0-9_./-]+$/.test(head) || head.includes('..'))
    throw new Error('Invalid HEAD.');
  const ref = head.slice(5);
  let commonDir = gitDir;
  try {
    commonDir = path.resolve(
      gitDir,
      (await readIssuerFile(path.join(gitDir, 'commondir'))).toString().trim(),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    return (await readIssuerFile(path.join(commonDir, ref))).toString().trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const packed = (
    await readIssuerFile(path.join(commonDir, 'packed-refs'), 1024 * 1024)
  ).toString();
  return packed
    .split(/\r?\n/)
    .find((line) => line.endsWith(` ${ref}`))
    ?.split(' ')[0];
}

export async function loadIssuerInputs(root, directory) {
  if (!isLocalIssuerPath(root) || !isLocalIssuerPath(directory))
    throw new Error('Local absolute package directory required.');
  const text = async (file) => (await readIssuerFile(file)).toString('utf8');
  const artifacts = new Map();
  for (const name of ['configuration', 'edge', 'frontend', 'lockfile', 'migrations']) {
    artifacts.set(
      name,
      await readIssuerFile(path.join(directory, 'artifacts', name), 16 * 1024 * 1024),
    );
  }
  return {
    manifestText: await text(path.join(root, 'config/feat-003-staging-environment.json')),
    packageText: await text(path.join(directory, 'package.json')),
    reviewText: await text(path.join(directory, 'review.json')),
    checkoutRevision: await readIssuerRevision(root),
    artifacts,
  };
}
