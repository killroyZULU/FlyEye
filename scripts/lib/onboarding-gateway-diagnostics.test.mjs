import { describe, expect, it, vi } from 'vitest';
import {
  collectGatewayDiagnostics,
  gatewayLogDetails,
  gatewayResponseDetails,
} from './onboarding-gateway-diagnostics.mjs';
import { fixtureDiagnostic, fixtureDiagnosticLines } from './fixture-diagnostics.mjs';

const secret = 'private-token-user-url-payload';
const config = {
  projectId: 'synthetic_ci',
  since: '2026-10-14T03:00:00.000Z',
  ci: 'true',
  githubActions: 'true',
};
function executor() {
  return vi.fn((_command, args) =>
    args[0] === 'inspect'
      ? { status: 0, stdout: JSON.stringify({ 'com.supabase.cli.project': config.projectId }) }
      : { status: 0, stdout: secret, stderr: `upstream prematurely closed connection ${secret}` },
  );
}

describe('bounded onboarding gateway evidence', () => {
  it.each([null, [], { toString: null }, { toString: 'private' }, 502, '__proto__'])(
    'cannot replace the HTTP failure when a provider code is malformed: %j',
    (code) => {
      expect(gatewayResponseDetails(new Response('', { status: 502 }), { code })).toEqual([
        'unknown-server-response',
      ]);
    },
  );
  it.each([
    ['BOOT_ERROR', 'worker-boot-error'],
    ['WORKER_ERROR', 'worker-error'],
    ['WORKER_LIMIT', 'worker-limit'],
  ])('classifies the fixed provider code %s without copying payloads', (code, expected) => {
    expect(
      gatewayResponseDetails(Response.json({}, { status: 503 }), { code, message: secret }),
    ).toEqual([expected]);
  });
  it('keeps gateway headers and unknown fields private', () => {
    const response = new Response('', {
      status: 502,
      headers: { server: 'kong/2.8.1', 'x-private': secret },
    });
    expect(
      gatewayResponseDetails(response, {
        message: 'An invalid response was received from the upstream server',
        secret,
      }),
    ).toEqual(['kong-response', 'upstream-invalid-response']);
    expect(
      gatewayResponseDetails(new Response('', { headers: { server: secret } }), {
        code: secret,
        message: secret,
      }),
    ).toEqual(['unknown-server-response']);
    expect(gatewayResponseDetails(new Response(), { message: 'name resolution failed' })).toEqual([
      'proxy-name-resolution',
    ]);
  });
  it.each([
    ['connect() failed (111: Connection refused)', 'upstream-refused'],
    ['recv() failed (104: Connection reset by peer)', 'upstream-reset'],
    ['upstream timed out', 'upstream-timeout'],
    ['InvalidWorkerCreation', 'worker-boot-error'],
    ['InvalidWorkerResponse', 'worker-error'],
    ['CPU time limit exceeded', 'worker-limit'],
    ['panic: runtime error: synthetic', 'provider-panic'],
    ['{"level":"error","msg":"private"}', 'provider-error-log'],
  ])('projects log signature %s to a fixed category', (signature, expected) => {
    expect(gatewayLogDetails(`${secret} ${signature} ${secret}`)).toEqual([expected]);
    expect(gatewayLogDetails(secret)).toEqual(['no-recognized-log-signature']);
  });
  it('attests each container and bounds read-only collection without retry', () => {
    const execute = executor();
    const evidence = collectGatewayDiagnostics({ ...config, execute });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls.map(([, args]) => args)).toEqual(
      ['kong', 'edge_runtime'].flatMap((service) => [
        [
          'inspect',
          '--type',
          'container',
          '--format',
          '{{json .Config.Labels}}',
          `supabase_${service}_synthetic_ci`,
        ],
        ['logs', '--since', config.since, '--tail', '200', `supabase_${service}_synthetic_ci`],
      ]),
    );
    for (const [, , options] of execute.mock.calls)
      expect(options).toMatchObject({
        timeout: 5000,
        maxBuffer: 262144,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    const lines = evidence.flatMap(({ stage, details }) =>
      details.map((detail) => fixtureDiagnostic('FEAT-003', stage, 'response', detail)),
    );
    expect(lines).toHaveLength(2);
    expect(fixtureDiagnosticLines('FEAT-003', lines.join('\n'))).toEqual(lines);
    expect(JSON.stringify(evidence)).not.toContain(secret);
  });
  it.each([
    { ci: 'false' },
    { githubActions: undefined },
    { projectId: '../foreign' },
    { since: secret },
    { services: ['foreign'] },
    { services: ['kong', 'auth', 'edge_runtime'] },
    { services: null },
  ])('does not inspect outside disposable CI: %j', (override) => {
    const execute = executor();
    expect(collectGatewayDiagnostics({ ...config, ...override, execute })).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
  it('attests only the selected gateway and Auth containers for a transport failure', () => {
    const execute = executor();
    const evidence = collectGatewayDiagnostics({ ...config, services: ['kong', 'auth'], execute });
    expect(evidence.map(({ stage }) => stage)).toEqual(['gateway-log', 'provider-log']);
    expect(execute.mock.calls.map(([, args]) => args.at(-1))).toEqual([
      'supabase_kong_synthetic_ci',
      'supabase_kong_synthetic_ci',
      'supabase_auth_synthetic_ci',
      'supabase_auth_synthetic_ci',
    ]);
    expect(
      fixtureDiagnosticLines(
        'FEAT-003',
        fixtureDiagnostic('FEAT-003', 'provider-log', 'response', 'provider-panic'),
      ),
    ).toHaveLength(1);
  });
  it.each([
    { status: 1, stdout: secret, stderr: secret },
    { status: 0, stdout: secret },
    { status: 0, stdout: '{"com.supabase.cli.project":"foreign"}' },
  ])('does not read logs when attestation fails', (result) => {
    const execute = vi.fn(() => result);
    expect(collectGatewayDiagnostics({ ...config, execute })).toEqual(
      ['gateway-log', 'worker-log'].map((stage) => ({
        stage,
        details: ['diagnostic-unavailable'],
      })),
    );
    expect(execute.mock.calls.every(([, args]) => args[0] === 'inspect')).toBe(true);
  });
  it.each(['throw', 'timeout', 'overflow'])('sanitizes collector failure: %s', (failure) => {
    const execute = executor();
    execute.mockImplementation((_command, args) => {
      if (args[0] === 'inspect')
        return {
          status: 0,
          stdout: JSON.stringify({ 'com.supabase.cli.project': config.projectId }),
        };
      if (failure === 'throw') throw new Error(secret);
      return { status: null, error: new Error(secret), stdout: secret, stderr: secret };
    });
    const result = collectGatewayDiagnostics({ ...config, execute });
    expect(result.every(({ details }) => details[0] === 'diagnostic-unavailable')).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(execute).toHaveBeenCalledTimes(4);
  });
});
