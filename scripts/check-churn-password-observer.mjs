import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { createServer } from 'node:http';
import { createChurnPasswordObserver } from './lib/churn-password-observer.mjs';
import { fixtureDiagnostic } from './lib/fixture-diagnostics.mjs';
import { withPasswordLoginTransportDiagnostics } from './lib/provider-transport-diagnostics.mjs';
import { runtimeDiagnosticLines } from './lib/runtime-diagnostics.mjs';

assert.equal(process.versions.node, '24.14.0');
assert.equal(process.versions.undici, '7.21.0');
const channels = [
  'request:create',
  'client:connected',
  'client:sendHeaders',
  'request:headers',
  'request:trailers',
  'request:error',
];
const privateText = 'SYNTHETIC_PRIVATE_HEADER_BODY';
const path = '/auth/v1/token?grant_type=password';

async function scenario(successes, expected) {
  let requests = 0;
  let observedError;
  let observer;
  const lines = [];
  const server = createServer((request, response) => {
    requests++;
    request.resume();
    if (requests > successes) request.socket.destroy();
    else response.writeHead(200, { 'content-type': 'text/plain' }).end('synthetic');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  const input = apiUrl + path;
  const options = Object.freeze({
    method: 'POST',
    body: privateText,
    headers: Object.freeze({ 'x-synthetic': privateText }),
  });
  const report = (stage, event, detail) =>
    lines.push(fixtureDiagnostic('FEAT-003', stage, event, detail));
  try {
    observer = createChurnPasswordObserver({
      apiUrl,
      projectId: 'synthetic_loopback',
      enabled: true,
      mode: 'factor-churn',
      ci: 'true',
      githubActions: 'true',
      report,
      collect: () => [],
    });
    const operation = () =>
      observer.observe(
        () =>
          withPasswordLoginTransportDiagnostics(
            async () => {
              try {
                return await fetch(input, options);
              } catch (error) {
                observedError = error;
                throw error;
              }
            },
            {
              input,
              method: options.method,
              apiUrl,
              report: (detail) => report('password-transport', 'failed', detail),
            },
          ),
        { input, method: options.method },
      );
    // A fixed sequence, not retries: two successful controls before the reused-socket failure.
    for (let index = 0; index < successes; index++) {
      const response = await operation();
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'synthetic');
    }
    await assert.rejects(operation(), (error) => error === observedError);
    assert.equal(requests, successes + 1);
    assert.ok(lines.some((line) => line.includes(`detail=${expected}.`)));
    assert.ok(lines.some((line) => line.includes('detail=transport-socket-closed.')));
    assert.deepEqual(runtimeDiagnosticLines('test-feat-003-runtime.mjs', lines.join('\n')), lines);
    for (const forbidden of [privateText, apiUrl, input])
      assert.equal(lines.join('\n').includes(forbidden), false);
  } finally {
    observer?.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert.equal(server.listening, false);
    assert.ok(channels.every((name) => !channel('undici:' + name).hasSubscribers));
  }
}

try {
  await scenario(0, 'password-socket-new');
  await scenario(2, 'password-socket-reused');
  process.stdout.write(
    'Pinned Node/Undici loopback observations passed: new and reused sockets, original error, sanitized output, owned-server and listener cleanup.\n',
  );
} catch {
  process.stderr.write(
    'Pinned Node/Undici loopback observation check failed; raw error suppressed.\n',
  );
  process.exitCode = 1;
}
