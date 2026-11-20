import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { stopLocalEdge } from './local-edge-lifecycle.mjs';
import { studentOrigin, studentGateway, tokenClaims } from './local-student-router.mjs';

function requireCheck(ok) {
  if (!ok) throw new Error('Local Student adapter check failed.');
}
function exchange(child, message, expected, limit) {
  return new Promise((resolve, reject) => {
    function finish(ok) {
      clearTimeout(timer);
      child.off('message', reply).off('exit', fail).off('disconnect', fail).off('error', fail);
      if (ok) resolve();
      else reject(new Error('Local Student worker did not complete its stage.'));
    }
    const reply = (value) => finish(value === expected);
    const fail = () => finish(false);
    const timer = setTimeout(fail, limit);
    child.once('message', reply).once('exit', fail).once('disconnect', fail).once('error', fail);
    if (!child.connected) return fail();
    if (message === undefined) return;
    try {
      child.send(message, (error) => {
        if (error) fail();
      });
    } catch {
      fail();
    }
  });
}

async function verifyClosedPort() {
  const url = new URL(studentOrigin);
  await new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    const uncertain = () => {
      socket.destroy();
      reject(new Error('Local Student listener closure uncertain.'));
    };
    socket.setTimeout(2000, uncertain);
    socket.once('connect', uncertain);
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') resolve();
      else uncertain();
    });
  });
}

function verifyGroupExited(child) {
  requireCheck(
    Number.isInteger(child.pid) &&
      child.pid > 0 &&
      (child.exitCode !== null || child.signalCode !== null),
  );
  try {
    process.kill(-child.pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return;
    throw error;
  }
  throw new Error('Local Student worker group still present.');
}

// Called only inside the locked, confirmed Student fixture. The callback owns its
// browser/context and must await browser shutdown before returning.
export async function withLocalStudentAdapter(
  loadStatus,
  userId,
  use,
  instructorFactorId,
  mfaRole,
) {
  requireCheck(
    process.platform === 'linux' &&
      process.version === 'v24.14.0' &&
      typeof use === 'function' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(userId),
  );
  const initial = loadStatus();
  requireCheck(
    initial.API_URL === studentGateway &&
      tokenClaims(initial.ANON_KEY)?.role === 'anon' &&
      tokenClaims(initial.SERVICE_ROLE_KEY)?.role === 'service_role',
  );
  const child = fork(new URL('./local-student-worker.mjs', import.meta.url), [], {
    cwd: new URL('../../', import.meta.url),
    detached: true,
    execArgv: [],
    env: { PATH: '/usr/bin:/bin', NODE_ENV: 'production' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  // Observe exit from spawn onwards, including a clean-looking premature exit.
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(code === 0 && signal === null));
    child.once('error', () => resolve(false));
  });
  let ready = false,
    stopped = false;
  try {
    await exchange(child, undefined, 'online', 15000);
    await exchange(child, { anon: initial.ANON_KEY }, 'built', 60000);
    const current = loadStatus();
    requireCheck(
      current.API_URL === studentGateway &&
        current.ANON_KEY === initial.ANON_KEY &&
        current.SERVICE_ROLE_KEY === initial.SERVICE_ROLE_KEY,
    );
    await exchange(
      child,
      {
        userId,
        service: current.SERVICE_ROLE_KEY,
        limiter: randomBytes(32).toString('hex'),
        ...(instructorFactorId === undefined ? {} : { instructorFactorId }),
        ...(mfaRole === undefined ? {} : { mfaRole }),
      },
      'ready',
      15000,
    );
    ready = true;
    return await use(Object.freeze({ origin: studentOrigin, publishableKey: initial.ANON_KEY }));
  } finally {
    try {
      if (ready) {
        await exchange(child, 'stop', 'closed', 10000);
        let timer;
        try {
          requireCheck(
            await Promise.race([
              exited,
              new Promise((resolve) => {
                timer = setTimeout(() => resolve(false), 5000);
              }),
            ]),
          );
        } finally {
          clearTimeout(timer);
        }
        verifyGroupExited(child);
        await verifyClosedPort();
        stopped = true;
      }
    } finally {
      if (
        !stopped &&
        child.exitCode === null &&
        child.signalCode === null &&
        Number.isInteger(child.pid)
      )
        await stopLocalEdge(child);
    }
  }
}
