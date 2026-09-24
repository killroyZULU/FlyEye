import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';

function git(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    throw new Error('Markdown discovery requires a readable Git checkout and adoption history.');
  }
}

function paths(output) {
  return output.split('\0').filter(Boolean);
}

export function repositoryMarkdown(root) {
  const candidates = paths(
    git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
  );
  return [...new Set(candidates)]
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .filter((name) => {
      try {
        const entry = lstatSync(resolve(root, name));
        if (entry.isSymbolicLink()) {
          throw new Error(`Markdown symlinks are not supported: ${name}`);
        }
        return entry.isFile();
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    })
    .sort();
}

// Fixed adoption point: moving this forward would exempt previously changed documents.
export const markdownAdoptionBaseline = 'a61fe352af846f80a0de7b2fd48f7dd74a2129f5';

export function markdownFormatScope(root, baseline = markdownAdoptionBaseline) {
  const files = repositoryMarkdown(root);
  const changed = new Set([
    ...paths(
      git(root, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', baseline, '--']),
    ),
    ...paths(
      git(root, [
        'diff',
        '--cached',
        '--no-ext-diff',
        '--no-textconv',
        '--name-only',
        '-z',
        baseline,
        '--',
      ]),
    ),
    ...paths(git(root, ['ls-files', '-z', '--others', '--exclude-standard'])),
  ]);
  const deferred = new Set(
    files.filter(
      (name) =>
        !changed.has(name) &&
        (name === 'AGENTS.md' || name.startsWith('docs/FlyEye_Documentation/')),
    ),
  );
  return {
    checked: files.filter((name) => !deferred.has(name)),
    deferred: files.filter((name) => deferred.has(name)),
  };
}
