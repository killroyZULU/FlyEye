import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { digest, linuxGoEnvironment, sha256 } from './linux-build-contract.mjs';

export const cleanupRejection = 'No-send Linux cleanup rejected or failed.';

// No generic cleanup CLI: callers supply the exact private mkdtemp child they own.
// Go's module cache contains 0555 directories; its supported cleanup handles them
// without making dependencies writable during acquisition, tests or compilation.
export function cleanupLinuxBuild({ repositoryRoot, work, compilerSha256, timeoutMs = 60_000 }) {
  try {
    if (process.platform !== 'linux' || typeof process.getuid !== 'function') throw new Error();
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new Error();
    if (typeof repositoryRoot !== 'string' || typeof work !== 'string') throw new Error();
    const root = path.posix.resolve(repositoryRoot);
    const output = path.posix.join(root, '.supabase/no-send-cli-linux');
    if (
      repositoryRoot !== root ||
      root === '/' ||
      path.posix.resolve(work) !== work ||
      path.posix.dirname(work) !== output ||
      !/^candidate-[A-Za-z0-9]{6}$/.test(path.posix.basename(work))
    )
      throw new Error();
    const uid = process.getuid();
    const directory = (name) => {
      const stat = lstatSync(name);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        stat.uid !== uid ||
        realpathSync(name) !== name
      )
        throw new Error();
      return stat;
    };
    directory(root);
    const outputStat = directory(output);
    const workStat = directory(work);
    if (workStat.dev !== outputStat.dev || (workStat.mode & 0o077) !== 0) throw new Error();
    const maybeStat = (name) => {
      try {
        return lstatSync(name);
      } catch (error) {
        if (error?.code === 'ENOENT') return undefined;
        throw error;
      }
    };
    const cache = path.posix.join(work, 'cache/modules');
    // Validate every existing cache ancestor even when modules has not been created.
    const cacheParent = path.posix.join(work, 'cache');
    if (maybeStat(cacheParent) && directory(cacheParent).dev !== workStat.dev) throw new Error();
    if (maybeStat(cache)) {
      if (directory(cache).dev !== workStat.dev) throw new Error();
      if (readdirSync(cache).length > 0) {
        if (!digest(compilerSha256)) throw new Error();
        for (const relative of ['compiler', 'compiler/go', 'compiler/go/bin']) {
          if (directory(path.posix.join(work, relative)).dev !== workStat.dev) throw new Error();
        }
        const go = path.posix.join(work, 'compiler/go/bin/go');
        const goStat = lstatSync(go);
        if (
          !goStat.isFile() ||
          goStat.isSymbolicLink() ||
          goStat.uid !== uid ||
          realpathSync(go) !== go ||
          sha256(readFileSync(go)) !== compilerSha256
        )
          throw new Error();
        const result = spawnSync(
          '/usr/bin/timeout',
          ['--signal=KILL', `${timeoutMs / 1000}s`, go, 'clean', '-modcache'],
          {
            cwd: work,
            env: linuxGoEnvironment(work, false),
            stdio: 'ignore',
          },
        );
        if (result.error || result.signal || result.status !== 0 || maybeStat(cache))
          throw new Error();
      }
    }
    // Recheck the private direct child after the subprocess, before removing it.
    const current = directory(work);
    const currentOutput = directory(output);
    if (
      current.ino !== workStat.ino ||
      current.dev !== workStat.dev ||
      currentOutput.ino !== outputStat.ino ||
      currentOutput.dev !== outputStat.dev
    )
      throw new Error();
    rmSync(work, { recursive: true });
    if (maybeStat(work)) throw new Error();
    return true;
  } catch {
    throw new Error(cleanupRejection);
  }
}
