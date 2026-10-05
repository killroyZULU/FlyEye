import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function startProductionBrowserServer(environment) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'flyeye-browser-build-'));
  const resolvedDirectory = await fs.realpath(directory);
  const temporaryRoot = await fs.realpath(os.tmpdir());
  if (
    path.dirname(resolvedDirectory) !== temporaryRoot ||
    !path.basename(resolvedDirectory).startsWith('flyeye-browser-build-')
  ) {
    throw new Error('Unexpected temporary build directory.');
  }
  const removeBuild = () => fs.rm(resolvedDirectory, { recursive: true, force: true });
  try {
    const build = spawnSync(
      process.execPath,
      ['node_modules/vite/bin/vite.js', 'build', '--outDir', resolvedDirectory],
      {
        env: environment,
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    if (build.status !== 0) throw new Error('Synthetic production browser build failed.');
    const budget = spawnSync(process.execPath, ['scripts/check-bundle.mjs', resolvedDirectory], {
      env: environment,
      encoding: 'utf8',
      timeout: 15_000,
    });
    if (budget.status !== 0) throw new Error('Synthetic production bundle budget failed.');
    process.stdout.write(budget.stdout);
    const expectedIndex = await fs.readFile(path.join(resolvedDirectory, 'index.html'), 'utf8');
    const manifest = JSON.parse(
      await fs.readFile(path.join(resolvedDirectory, '.vite/manifest.json'), 'utf8'),
    );
    const child = spawn(
      process.execPath,
      [
        'node_modules/vite/bin/vite.js',
        'preview',
        '--outDir',
        resolvedDirectory,
        '--host',
        '127.0.0.1',
        '--port',
        '4173',
        '--strictPort',
      ],
      {
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.resume();
    child.stderr.resume();
    return {
      child,
      expectedIndex,
      manifest,
      async close() {
        if (child.exitCode === null && child.signalCode === null) {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Production browser server shutdown could not be confirmed.')),
              5000,
            );
            child.once('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
            child.kill();
          });
        }
        await removeBuild();
      },
    };
  } catch (error) {
    await removeBuild();
    throw error;
  }
}
