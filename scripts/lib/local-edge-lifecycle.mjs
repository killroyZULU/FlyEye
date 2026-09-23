import { spawnSync } from 'node:child_process';
import process from 'node:process';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// A shared OPTIONS response proves routing, not that this fixture's environment
// is active. The caller supplies a fresh exact origin for its worker.
export async function waitForLocalEdge(url, origin, child) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
    throw new Error('Local Edge readiness requires a loopback URL.');
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Local Edge process exited before readiness.');
    }
    try {
      const response = await fetch(url, {
        method: 'OPTIONS',
        headers: { origin },
        signal: AbortSignal.timeout(1_000),
      });
      if (
        response.status === 204 &&
        response.headers.get('access-control-allow-origin') === origin
      ) {
        return;
      }
    } catch {
      // A starting worker may temporarily have no route.
    }
    await delay(250);
  }
  throw new Error('The fixture-specific local Edge worker did not become ready.');
}

function groupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForTreeExit(child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (exited && (process.platform === 'win32' || !groupExists(child.pid))) return true;
    await delay(100);
  }
  return false;
}

// POSIX callers must spawn with detached:true. Windows taskkill targets only
// this fixture's process tree, including the native CLI beneath its Node wrapper.
export async function stopLocalEdge(child) {
  if (!child) return;
  if (!Number.isInteger(child.pid) || child.pid <= 0) {
    throw new Error('Local Edge process identity is unavailable.');
  }
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Exited local Edge wrapper leaves descendant shutdown uncertain.');
    }
    const result = spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      timeout: 10_000,
      windowsHide: true,
    });
    if (result.status !== 0) throw new Error('Local Edge process tree shutdown failed.');
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  if (await waitForTreeExit(child)) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    if (await waitForTreeExit(child)) return;
  }
  throw new Error('Local Edge process tree shutdown remained uncertain.');
}
