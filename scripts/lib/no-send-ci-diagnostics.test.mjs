import { describe, expect, it } from 'vitest';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

const fixture = 'test-staging-no-send-runtime.mjs';
const line = (value) => JSON.stringify({ noSendBehavior: value });
describe('no-send CI diagnostic privacy boundary', () => {
  it('reconstructs bounded labels and cleanup, dropping all raw fields', () => {
    const output = [
      'No-send compatibility: loopback bindings and local SMTP containment passed.',
      line({ stage: 'password-totp-regression', passed: true, secret: 'private-canary' }),
      line({
        stage: 'cleanup',
        passed: false,
        category: 'cleanup-uncertain',
        error: 'private-canary',
      }),
      'raw provider private-canary',
    ].join('\n');
    expect(runtimeDiagnosticLines(fixture, output)).toEqual([
      'No-send compatibility: loopback bindings and local SMTP containment passed.',
      'No-send runtime: stage=password-totp-regression result=passed.',
      'No-send runtime: stage=cleanup result=failed category=cleanup-uncertain.',
      'No-send runtime evidence: observed; cleanup=failed.',
    ]);
  });
  it('does not treat missing or unreadable evidence as cleanup success', () => {
    for (const output of [
      undefined,
      '',
      '{bad JSON',
      line({ stage: 'private-canary', passed: true }),
      line({ stage: 'cleanup', passed: 'true' }),
    ])
      expect(runtimeDiagnosticLines(fixture, output)).toEqual([
        'No-send runtime evidence: unavailable; cleanup=unobserved.',
      ]);
  });
  it('bounds line size/count and classifies unknown errors without forwarding them', () => {
    const output = [
      line({ stage: 'startup-control', passed: false, category: 'private-canary' }),
      line({ stage: 'cleanup', passed: true, value: 'x'.repeat(4096) }),
      ...Array.from({ length: 100 }, () => line({ stage: 'recovery', passed: true })),
    ].join('\n');
    const result = runtimeDiagnosticLines(fixture, output);
    expect(result).toHaveLength(65);
    expect(result[0]).toContain('category=unknown');
    expect(result.at(-1)).toContain('cleanup=unobserved');
    expect(result.join('')).not.toContain('private-canary');
  });
  it('keeps failure sticky and cannot turn enrollment-only observation into full proof', () => {
    expect(
      runtimeDiagnosticLines(
        fixture,
        [line({ stage: 'cleanup', passed: false }), line({ stage: 'cleanup', passed: true })].join(
          '\n',
        ),
      ).at(-1),
    ).toContain('cleanup=failed');
    expect(
      runtimeDiagnosticLines(
        fixture,
        line({ stage: 'totp-enrollment-observation', passed: true }),
      )[0],
    ).toContain('unavailable');
    expect(
      runtimeDiagnosticLines('test-feat-006-runtime.mjs', line({ stage: 'cleanup', passed: true })),
    ).toEqual([]);
  });
});
