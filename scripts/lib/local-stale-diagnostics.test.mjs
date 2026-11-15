// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { orderedMounts, startupFailureDiagnostic } from './local-stale-diagnostics.mjs';

describe('mount inventory ordering', () => {
  const a = {
    Type: 'bind',
    Source: '/synthetic/a',
    Destination: '/a',
    Mode: 'ro',
    RW: false,
    Propagation: 'rprivate',
  };
  const b = {
    Type: 'volume',
    Name: 'synthetic',
    Source: '/synthetic/b',
    Destination: '/b',
    Driver: 'local',
    RW: true,
    FutureField: { keep: 1 },
  };
  it('normalizes order without mutating, dropping fields or deduplicating', () => {
    const input = Object.freeze([Object.freeze(b), Object.freeze(a), b]);
    expect(orderedMounts(input)).toEqual(orderedMounts([a, b, b]));
    expect(input).toEqual([b, a, b]);
    expect(orderedMounts(input)).toHaveLength(3);
  });
  it.each(Object.keys(b))('retains changes to %s, including unfamiliar fields', (key) => {
    expect(orderedMounts([a, { ...b, [key]: 'changed' }])).not.toEqual(orderedMounts([a, b]));
  });
  it('rejects a missing or malformed inventory', () => {
    for (const value of [undefined, null, {}, 'synthetic'])
      expect(() => orderedMounts(value)).toThrow();
  });
});

describe('bounded startup failure diagnostics', () => {
  it.each([
    ['invalid config', 'configuration'],
    ['failed migration SQLSTATE', 'migration'],
    ['failed to pull', 'image'],
    ['unhealthy', 'health'],
    ['connection refused', 'network'],
    ['address already in use', 'port'],
    ['timed out', 'timeout'],
    ['FlyEye disposable binding target rejected', 'guard'],
    ['synthetic private content', 'unknown'],
  ])('classifies %s into a fixed observation only', (stderr, category) => {
    expect(startupFailureDiagnostic({ status: 1, stderr }).category).toBe(category);
  });
  it('does not choose a cause when multiple categories occur across streams', () => {
    expect(
      startupFailureDiagnostic({ status: 1, stdout: 'SQLSTATE', stderr: 'connection refused' })
        .category,
    ).toBe('ambiguous');
  });
  it.each([
    [{}, 'missing'],
    [{ stdout: '', stderr: '' }, 'empty'],
    [{ stderr: Buffer.from('SQLSTATE') }, 'unreadable'],
    [{ stderr: { message: 'SQLSTATE' } }, 'unreadable'],
    [{ stdout: 'SQLSTATE', stderr: 'x'.repeat(32769) }, 'oversize'],
    [{ stderr: 'é'.repeat(16385) }, 'oversize'],
  ])('reports unavailable output explicitly', (value, output) => {
    expect(startupFailureDiagnostic(value)).toMatchObject({ output, category: 'unknown' });
  });
  it('accepts exactly the per-stream byte limit without truncation', () => {
    expect(startupFailureDiagnostic({ stderr: 'SQLSTATE' + 'x'.repeat(32760) })).toMatchObject({
      output: 'available',
      category: 'migration',
    });
  });
  it.each([-1, 256, 1.5, '1', NaN])('does not forward an invalid exit code', (status) => {
    expect(startupFailureDiagnostic({ status }).exitCode).toBe('unknown');
  });
  it.each([0, 1, 255])('retains a bounded exit code', (status) => {
    expect(startupFailureDiagnostic({ status }).exitCode).toBe(status);
  });
  it.each(['ETIMEDOUT', 'ENOBUFS', 'ENOENT', 'EACCES'])('retains only allowlisted %s', (code) => {
    expect(startupFailureDiagnostic({ error: { code } }).error).toBe(code);
  });
  it.each(['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT'])(
    'retains only allowlisted %s',
    (signal) => {
      expect(startupFailureDiagnostic({ signal }).signal).toBe(signal);
    },
  );
  it('never forwards private strings, arbitrary fields, signal or error text', () => {
    const privateValue = 'synthetic-private-value';
    const value = startupFailureDiagnostic({
      status: privateValue,
      signal: privateValue,
      error: { code: privateValue, message: privateValue, stack: privateValue },
      stdout: privateValue,
      stderr: privateValue,
      extra: privateValue,
    });
    expect(value).toEqual({
      exitCode: 'unknown',
      signal: 'unknown',
      error: 'unknown',
      output: 'available',
      category: 'unknown',
    });
    expect(Object.isFrozen(value)).toBe(true);
    expect(JSON.stringify(value)).not.toContain(privateValue);
  });
  it('reports missing result metadata as unknown', () => {
    expect(startupFailureDiagnostic()).toEqual({
      exitCode: 'unknown',
      signal: 'unknown',
      error: 'unknown',
      output: 'missing',
      category: 'unknown',
    });
  });
  it.each([{}, 'synthetic-private-error', { message: 'synthetic-private-error' }])(
    'does not report an unreadable error code as no error',
    (error) => {
      expect(startupFailureDiagnostic({ error }).error).toBe('unknown');
    },
  );
});
