import { describe, expect, it } from 'vitest';

import { feat006Diagnostic, runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

describe('runtime diagnostic output boundary', () => {
  const fixture = 'test-feat-006-runtime.mjs';

  it('retains fixed stage outcomes while suppressing provider and assertion output', () => {
    const entered = feat006Diagnostic('factor-bind', 'enter');
    const failed = feat006Diagnostic('factor-bind', 'failed');
    const cleaned = feat006Diagnostic('fixture-cleanup', 'passed');
    expect(
      runtimeDiagnosticLines(
        fixture,
        [entered, 'provider payload: synthetic-sensitive-value', failed, cleaned].join('\r\n'),
      ),
    ).toEqual([entered, failed, cleaned]);
  });

  it('rejects unknown stages, arbitrary events, decorated lines and other fixtures', () => {
    const valid = feat006Diagnostic('totp-verify', 'failed');
    const rejected = [
      'FEAT-006 runtime diagnostic: stage=synthetic-sensitive-value event=failed.',
      'FEAT-006 runtime diagnostic: stage=totp-verify event=syntheticsecret.',
      `${valid} provider payload`,
      `prefix ${valid}`,
      `\u001b[31m${valid}`,
      'FEAT-003 runtime diagnostic: stage=totp-verify event=enter.',
    ];
    expect(runtimeDiagnosticLines(fixture, rejected.join('\n'))).toEqual([]);
    expect(runtimeDiagnosticLines('test-feat-005-runtime.mjs', valid)).toEqual([]);
    expect(runtimeDiagnosticLines(fixture, undefined)).toEqual([]);
    expect(() => feat006Diagnostic('synthetic-secret', 'failed')).toThrow();
    expect(() => feat006Diagnostic('totp-verify', 'synthetic-secret')).toThrow();
  });

  it('preserves the existing FEAT-003 allowlist without accepting FEAT-006 output', () => {
    const valid = 'FEAT-003 runtime diagnostic: stage=fixture-cleanup event=passed.';
    expect(
      runtimeDiagnosticLines(
        'test-feat-003-runtime.mjs',
        `${valid}\n${feat006Diagnostic('fixture-cleanup', 'passed')}\nprovider payload`,
      ),
    ).toEqual([valid]);
  });
});
