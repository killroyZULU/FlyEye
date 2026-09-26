import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { createFixtureDiagnostics, fixtureDiagnostic } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

function recorder(feature = 'FEAT-007B', enabled = true) {
  const lines = [];
  return {
    lines,
    diagnostics: createFixtureDiagnostics(feature, { enabled, write: (line) => lines.push(line) }),
  };
}

describe('sanitized fixture failure evidence', () => {
  it.each(['FEAT-004', 'FEAT-005', 'FEAT-007', 'FEAT-007B'])(
    'keeps %s scenario failure distinct from cleanup success',
    async (feature) => {
      const { lines, diagnostics } = recorder(feature);
      diagnostics.enter('authentication');
      diagnostics.fail(new Error('synthetic-private-payload'));
      await diagnostics.run('fixture-cleanup', () =>
        diagnostics.run('cleanup-auth-users', async () => {}),
      );
      expect(lines).toEqual([
        fixtureDiagnostic(feature, 'authentication', 'enter'),
        fixtureDiagnostic(feature, 'authentication', 'failed', 'unclassified'),
        fixtureDiagnostic(feature, 'fixture-cleanup', 'enter'),
        fixtureDiagnostic(feature, 'cleanup-auth-users', 'enter'),
        fixtureDiagnostic(feature, 'cleanup-auth-users', 'passed'),
        fixtureDiagnostic(feature, 'fixture-cleanup', 'passed'),
      ]);
      expect(
        runtimeDiagnosticLines(`test-${feature.toLowerCase()}-runtime.mjs`, lines.join('\n')),
      ).toEqual(lines);
    },
  );

  it('propagates shutdown and residue failures without reporting cleanup passed', async () => {
    for (const stage of ['cleanup-edge-shutdown', 'cleanup-assertions']) {
      const { lines, diagnostics } = recorder();
      const error = new Error('synthetic-private-payload');
      await expect(
        diagnostics.run('fixture-cleanup', () =>
          diagnostics.run(stage, async () => {
            throw error;
          }),
        ),
      ).rejects.toBe(error);
      expect(lines).not.toContain(fixtureDiagnostic('FEAT-007B', 'fixture-cleanup', 'passed'));
      expect(lines.at(-2)).toBe(fixtureDiagnostic('FEAT-007B', stage, 'failed', 'unclassified'));
      expect(lines.join('\n')).not.toContain(error.message);
    }
  });

  it.each([
    [502, { message: 'private' }, 'gateway-502'],
    [503, { message: 'name resolution failed' }, 'proxy-name-resolution'],
    [
      503,
      { error: { code: 'aircraft_documents.storage_unavailable', message: 'private' } },
      'storage-unavailable',
    ],
    [503, { error: { code: 'aircraft_documents.audit_failed' } }, 'audit-failed'],
    [503, { error: { code: 'aircraft_documents.scan_failed' } }, 'scan-failed'],
    [503, { error: { code: 'aircraft_documents.scan_unavailable' } }, 'scan-unavailable'],
    [503, { error: { code: 'aircraft_documents.service_unavailable' } }, 'service-unavailable'],
    [503, { error: { code: 'private' }, signedUrl: 'private' }, 'unknown-server-response'],
    [503, { error: { code: 'member_mfa.storage_unavailable' } }, 'unknown-server-response'],
  ])('classifies HTTP %i using a fixed response category %j', async (status, payload, detail) => {
    const { lines, diagnostics } = recorder();
    diagnostics.enter('file-complete');
    const response = Response.json(payload, { status });
    expect(await diagnostics.readResponse(response)).toEqual({ response, payload });
    expect(lines.at(-1)).toBe(fixtureDiagnostic('FEAT-007B', 'file-complete', 'response', detail));
    try {
      assert.equal(status, 200, JSON.stringify(payload));
    } catch (error) {
      diagnostics.fail(error);
    }
    expect(lines.at(-1)).toBe(
      fixtureDiagnostic('FEAT-007B', 'file-complete', 'failed', `http-${status}`),
    );
    expect(lines.join('\n')).not.toContain('private');
  });

  it('records bounded retry evidence and leaves decoding failures visible without raw output', async () => {
    const { lines, diagnostics } = recorder();
    diagnostics.enter('file-initiate');
    diagnostics.retry(503);
    try {
      await diagnostics.readResponse(new Response('private', { status: 503 }));
    } catch (error) {
      diagnostics.fail(error);
    }
    expect(lines.slice(1)).toEqual([
      fixtureDiagnostic('FEAT-007B', 'file-initiate', 'retry', 'http-503'),
      fixtureDiagnostic('FEAT-007B', 'file-initiate', 'response', 'unknown-server-response'),
      fixtureDiagnostic('FEAT-007B', 'file-initiate', 'failed', 'response-decoding-failed'),
    ]);
  });

  it('suppresses arbitrary details, decorated output and another fixture vocabulary', () => {
    const valid = fixtureDiagnostic('FEAT-005', 'profile-update', 'failed', 'http-503');
    const bad = [
      valid + ' private',
      'prefix ' + valid,
      '\u001b[31m' + valid,
      valid.replace('http-503', 'private'),
      valid.replace('profile-update', 'private'),
      valid.replace('failed', 'passed'),
      valid.replace('FEAT-005', 'FEAT-007'),
      fixtureDiagnostic('FEAT-007B', 'file-complete', 'response', 'storage-unavailable'),
    ];
    expect(runtimeDiagnosticLines('test-feat-005-runtime.mjs', [valid, ...bad].join('\n'))).toEqual(
      [valid],
    );
    expect(() => fixtureDiagnostic('FEAT-005', 'authentication', 'retry', 'http-401')).toThrow();
  });

  it('supports disabled diagnostics without swallowing operation failures', async () => {
    const { lines, diagnostics } = recorder('FEAT-007', false);
    const operation = vi.fn().mockRejectedValue(new Error('private'));
    diagnostics.enter('authentication');
    await expect(diagnostics.run('fixture-cleanup', operation)).rejects.toThrow('private');
    diagnostics.fail(new Error());
    expect(lines).toEqual([]);
    expect(operation).toHaveBeenCalledOnce();
  });
});
