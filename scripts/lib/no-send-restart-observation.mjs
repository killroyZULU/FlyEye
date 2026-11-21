import assert from 'node:assert/strict';
import { localNoSendProject } from './no-send-local-project.mjs';
import { createNoSendHttpClient } from './no-send-http-client.mjs';

const names = new Set([
  'TypeError',
  'SyntaxError',
  'AbortError',
  'TimeoutError',
  'AssertionError',
  'Error',
]);
const codes = new Set([
  'ERR_ASSERTION',
  'ERR_INVALID_URL',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_ABORTED',
]);
const steps = new Set([
  'startup',
  'client-open',
  'client-close',
  'status-command',
  'status-json',
  'status-origin',
  'status-keys',
  'sink-request',
  'sink-body',
  'sink-json',
  'sink-count',
  'privacy',
  'cleanup',
]);

export function restartErrorCategory(error) {
  const command =
    /^No-send disposable command failed: (configuration|migration|image|health|network|port|timeout|unknown)\.$/.exec(
      error?.message ?? '',
    );
  return {
    name: names.has(error?.name) ? error.name : 'unknown',
    code: codes.has(error?.code) ? error.code : 'unknown',
    causeCode: codes.has(error?.cause?.code) ? error.cause.code : 'unknown',
    commandCategory: command?.[1] ?? 'not-classified',
  };
}

// Exactly one transition and one sink GET per phase. No Auth HTTP calls, users,
// email routes, sleeps, retries or global dispatcher changes.
export async function observeNoSendRestart({
  makeProject = localNoSendProject,
  makeClient = createNoSendHttpClient,
  emit = (event) => process.stdout.write(`${JSON.stringify({ noSendRestart: event })}\n`),
} = {}) {
  let project;
  let client;
  let clientCleanupPassed = true;
  let phase = 'before-restart';
  let step = 'startup';
  let httpStatus = null;
  let mailCount = null;
  let passed = false;
  let cleanupPassed = false;
  const secrets = new Set();
  function observe(next, outcome, status) {
    assert.ok(steps.has(next));
    assert.ok(outcome === 'entered' || outcome === 'passed');
    step = next;
    if (status !== undefined) {
      assert.ok(Number.isInteger(status) && status >= 100 && status <= 599);
      httpStatus = status;
    }
    emit({ phase, step, outcome, httpStatus, mailCount });
  }
  const failure = (error) =>
    emit({ phase, step, outcome: 'failed', httpStatus, mailCount, ...restartErrorCategory(error) });
  try {
    project = makeProject();
    for (const afterRestart of [false, true]) {
      phase = afterRestart ? 'after-restart' : 'before-restart';
      httpStatus = null;
      mailCount = null;
      observe('startup', 'entered');
      if (afterRestart) project.enableHook();
      else project.start(false);
      observe('startup', 'passed');
      const status = project.status(observe);
      observe('status-keys', 'entered');
      for (const name of ['ANON_KEY', 'SERVICE_ROLE_KEY']) {
        assert.ok(typeof status[name] === 'string' && status[name].length > 20);
        secrets.add(status[name]);
      }
      observe('status-keys', 'passed');
      observe('client-open', 'entered');
      client = makeClient();
      clientCleanupPassed = false;
      observe('client-open', 'passed');
      const result = await client.request('http://127.0.0.1:58324/api/v1/messages', {}, observe);
      observe('sink-count', 'entered');
      assert.equal(result.status, 200);
      assert.ok(Number.isInteger(result.body.total) && result.body.total >= 0);
      mailCount = result.body.total;
      assert.equal(mailCount, 0);
      observe('sink-count', 'passed');
      observe('client-close', 'entered');
      await client.close();
      client = undefined;
      clientCleanupPassed = true;
      observe('client-close', 'passed');
    }
    passed = true;
  } catch (error) {
    failure(error);
  } finally {
    if (project) {
      phase = 'finalization';
      httpStatus = null;
      mailCount = null;
      if (client) {
        try {
          observe('client-close', 'entered');
          await client.close();
          client = undefined;
          clientCleanupPassed = true;
          observe('client-close', 'passed');
        } catch (error) {
          passed = false;
          failure(error);
        }
      }
      try {
        observe('privacy', 'entered');
        assert.ok(secrets.size > 0);
        assert.equal(project.logsContain([...secrets]), false);
        observe('privacy', 'passed');
      } catch (error) {
        passed = false;
        failure(error);
      }
      try {
        observe('cleanup', 'entered');
        project.close();
        cleanupPassed = true;
        observe('cleanup', 'passed');
      } catch (error) {
        passed = false;
        failure(error);
      }
    }
  }
  return { passed, cleanupPassed: cleanupPassed && clientCleanupPassed };
}
