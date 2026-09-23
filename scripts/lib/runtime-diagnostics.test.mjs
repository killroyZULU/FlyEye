import { describe, expect, it } from 'vitest';

import { feat006Diagnostic, runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

describe('runtime diagnostic output boundary', () => {
  const fixture = 'test-feat-006-runtime.mjs';

  it('retains aircraft file diagnostics without leaking payloads or accepting MFA stages', () => {
    const entered = 'FEAT-007B runtime diagnostic: stage=file-lifecycle event=enter.';
    const failed =
      'FEAT-007B runtime diagnostic: stage=metadata-create event=failed detail=http-404.';
    const rejected = [
      'FEAT-007B runtime diagnostic: stage=synthetic-secret event=enter.',
      'FEAT-007B runtime diagnostic: stage=file-lifecycle event=failed detail=synthetic-secret.',
      'FEAT-007B runtime diagnostic: stage=file-lifecycle event=passed detail=http-404.',
      'FEAT-007B runtime diagnostic: stage=factor-bind event=enter.',
      `${failed} provider payload`,
      'provider payload: synthetic-secret',
      feat006Diagnostic('fixture-cleanup', 'passed'),
    ];
    expect(
      runtimeDiagnosticLines(
        'test-feat-007b-runtime.mjs',
        [entered, failed, ...rejected].join('\n'),
      ),
    ).toEqual([entered, failed]);
    expect(runtimeDiagnosticLines(fixture, `${entered}\n${failed}`)).toEqual([]);
  });

  it('identifies cleanup failures without forwarding error payloads', () => {
    const failed = feat006Diagnostic('cleanup-discarded-event', 'failed', 'assertion');
    expect(
      runtimeDiagnosticLines(fixture, `${failed}\nAssertionError: synthetic-private-key`),
    ).toEqual([failed]);
    expect(() => feat006Diagnostic('cleanup-synthetic-private-key', 'failed')).toThrow();
  });

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

  it('allows fixed retry/failure categories without exposing arbitrary detail', () => {
    const retry = feat006Diagnostic('factor-bind', 'retry', 'http-502');
    const failed = feat006Diagnostic('factor-bind', 'failed', 'http-409');
    expect(runtimeDiagnosticLines(fixture, `${retry}\n${failed}`)).toEqual([retry, failed]);
    for (const [event, detail] of [
      ['failed', 'synthetic-sensitive-value'],
      ['retry', 'http-401'],
      ['retry', undefined],
      ['passed', 'http-502'],
    ]) {
      expect(() => feat006Diagnostic('factor-bind', event, detail)).toThrow();
      const suffix = detail === undefined ? '' : ` detail=${detail}`;
      expect(
        runtimeDiagnosticLines(
          fixture,
          `FEAT-006 runtime diagnostic: stage=factor-bind event=${event}${suffix}.`,
        ),
      ).toEqual([]);
    }
  });
});
