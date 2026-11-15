// @vitest-environment node
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matrixOptions, requireCompletePartitions, runtimePlan } from './runtime-matrix-plan.mjs';

const fixtures = readdirSync('scripts')
  .filter((name) => /^test-[a-z0-9-]+-runtime\.mjs$/.test(name))
  .sort();
const options = { provider: true };
const full = runtimePlan(fixtures, options);
const core = runtimePlan(fixtures, { ...options, partition: 'core' });
const stale = runtimePlan(fixtures, { ...options, partition: 'stale' });

describe('mandatory runtime partition inventory', () => {
  it('retains the complete existing CI inventory exactly once', () => {
    expect(fixtures).toEqual([
      'test-edge-runtime.mjs',
      'test-feat-003-runtime.mjs',
      'test-feat-004-runtime.mjs',
      'test-feat-005-runtime.mjs',
      'test-feat-006-runtime.mjs',
      'test-feat-006b-runtime.mjs',
      'test-feat-007-runtime.mjs',
      'test-feat-007b-runtime.mjs',
      'test-recovery-runtime.mjs',
      'test-staging-no-send-runtime.mjs',
    ]);
    expect(full).toHaveLength(28);
    expect(core).toHaveLength(26);
    expect(stale).toEqual([
      { fixture: 'test-feat-003-runtime.mjs', modeIndex: 9, args: ['--stale-cleanup-probe'] },
      { fixture: 'test-feat-003-runtime.mjs', modeIndex: 10, args: ['--stale-factors'] },
    ]);
    expect(() => requireCompletePartitions(full, [core, stale])).not.toThrow();
    expect(new Set([...core, ...stale].map((x) => `${x.fixture}:${x.modeIndex}`)).size).toBe(
      full.length,
    );
    const sorted = (items) => items.map((item) => JSON.stringify(item)).sort();
    expect(sorted([...core, ...stale])).toEqual(sorted(full));
    expect(full.filter((x) => !x.args[0]?.startsWith('--stale-'))).toEqual(core);
    expect(core.find((x) => x.fixture === 'test-staging-no-send-runtime.mjs').args).toEqual([]);
    expect(runtimePlan(fixtures, { provider: false })).toHaveLength(15);
  });

  it('automatically retains a new discovered fixture in core and in the default route', () => {
    const extended = [...fixtures, 'test-synthetic-new-runtime.mjs'];
    expect(runtimePlan(extended, { ...options, partition: 'core' }).at(-1)).toEqual({
      fixture: 'test-synthetic-new-runtime.mjs',
      modeIndex: 0,
      args: [],
    });
    expect(runtimePlan(extended, options)).toHaveLength(full.length + 1);
  });

  it.each([
    () => [[], stale],
    () => [core, []],
    () => [core.slice(1), stale],
    () => [core, [...stale, core[0]]],
    () => [[...core, core[0]], stale],
    () => [core, [{ ...stale[0], args: ['--different'] }, stale[1]]],
    () => [core, [{ ...stale[0], modeIndex: 999 }, stale[1]]],
    () => [core],
  ])('rejects empty, missing, overlapping or altered assignments', (mutate) => {
    expect(() => requireCompletePartitions(full, mutate())).toThrow();
  });

  it.each([
    { names: [] },
    { names: [fixtures[0], fixtures[0]] },
    { names: ['private-invalid-path'] },
  ])('rejects malformed inventories', ({ names }) => {
    expect(() => runtimePlan(names, options)).toThrow('Invalid runtime matrix selection.');
  });

  it('rejects an empty stale selection and partitions outside disposable CI', () => {
    expect(() =>
      runtimePlan(['test-edge-runtime.mjs'], { ...options, partition: 'stale' }),
    ).toThrow();
    expect(() => runtimePlan(fixtures, { provider: false, partition: 'core' })).toThrow();
    expect(() => runtimePlan(fixtures, { ...options, partition: '' })).toThrow();
    expect(() => requireCompletePartitions([], [[], []])).toThrow();
    expect(() => requireCompletePartitions([...full, full[0]], [core, stale])).toThrow();
  });
});

describe('closed runtime selection interface', () => {
  it('preserves default full execution and listing', () => {
    expect(matrixOptions([])).toEqual({ partition: 'full', list: false });
    expect(matrixOptions(['--list'])).toEqual({ partition: 'full', list: true });
    for (const partition of ['full', 'core', 'stale'])
      expect(matrixOptions([`--partition=${partition}`, '--list'])).toEqual({
        partition,
        list: true,
      });
  });
  it.each([
    ['--partition='],
    ['--partition=unknown'],
    ['--partition', 'core'],
    ['--skip=stale'],
    ['--partition=core', '--partition=stale'],
    ['--partition=core', '--partition=core'],
    ['--list', '--list'],
    ['--partition=full,core'],
  ])('rejects invalid, empty or overlapping selection %j', (...args) => {
    expect(() => matrixOptions(args)).toThrow();
  });
});
