import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fixture: 'test-feat-006b-runtime.mjs',
  spawnSync: vi.fn(),
  stdout: vi.fn(),
  stderr: vi.fn(),
  exit: vi.fn(),
}));
vi.mock('node:fs', () => {
  const fs = { readdirSync: () => [{ isFile: () => true, name: mocks.fixture }] };
  return { ...fs, default: fs };
});
vi.mock('node:child_process', () => ({
  spawnSync: mocks.spawnSync,
  default: { spawnSync: mocks.spawnSync },
}));
vi.mock('node:process', async (original) => {
  const actual = await original();
  return {
    default: {
      ...actual.default,
      argv: [],
      stdout: { write: mocks.stdout },
      stderr: { write: mocks.stderr },
      exit: mocks.exit,
    },
  };
});

afterEach(() => {
  mocks.fixture = 'test-feat-006b-runtime.mjs';
  vi.resetAllMocks();
  vi.resetModules();
});

describe('runtime matrix FEAT-006B diagnostics integration', () => {
  it.each([0, 1])('captures only sanitized child output for exit %s', async (status) => {
    const diagnostic = 'FEAT-006B runtime diagnostic: stage=fixture-cleanup event=passed.';
    const privateText = 'synthetic-private-provider-payload';
    mocks.spawnSync.mockImplementation((_command, args) =>
      args[0].endsWith('test-feat-006b-runtime.mjs')
        ? {
            status,
            stdout: `${diagnostic}\n${privateText}\n${diagnostic} ${privateText}`,
            stderr: privateText,
          }
        : { status: 0 },
    );
    mocks.exit.mockImplementation(() => {
      throw new Error('test-exit');
    });
    const run = import('../run-runtime-matrix.mjs');
    if (status) await expect(run).rejects.toThrow('test-exit');
    else await run;
    const child = mocks.spawnSync.mock.calls.find(([, args]) =>
      args[0].endsWith('test-feat-006b-runtime.mjs'),
    );
    expect(child[2]).toMatchObject({
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { FLYEYE_RUNTIME_DIAGNOSTICS: '1' },
    });
    const output = [...mocks.stdout.mock.calls, ...mocks.stderr.mock.calls].flat().join('');
    expect(output).toContain(diagnostic);
    expect(output).not.toContain(privateText);
    expect(output.includes('Runtime matrix passed: test-feat-006b-runtime.mjs.')).toBe(
      status === 0,
    );
  });
});

describe('A026 runtime probe gate', () => {
  it.each(['test-edge-runtime.mjs', 'test-recovery-runtime.mjs'])(
    'runs a cleanup probe before %s and filters both outputs',
    async (fixture) => {
      mocks.fixture = fixture;
      const feature = fixture === 'test-edge-runtime.mjs' ? 'FEAT-001' : 'FEAT-002';
      const line = `${feature} runtime diagnostic: stage=fixture-cleanup event=passed.`;
      mocks.spawnSync.mockImplementation((_command, args) =>
        args[0].endsWith(fixture)
          ? { status: 0, stdout: `${line}\nprivate-token`, stderr: 'private-token' }
          : { status: 0 },
      );
      await import('../run-runtime-matrix.mjs');
      const children = mocks.spawnSync.mock.calls.filter(([, args]) => args[0].endsWith(fixture));
      expect(children).toHaveLength(2);
      expect(children[0][1]).toContain('--cleanup-probe');
      expect(children[1][1]).not.toContain('--cleanup-probe');
      for (const child of children) expect(child[2].stdio).toEqual(['ignore', 'pipe', 'ignore']);
      expect(mocks.stdout.mock.calls.flat().join('')).not.toContain('private-token');
      expect(mocks.stdout.mock.calls.flat().join('')).toContain('(cleanup probe)');
    },
  );

  it('stops the matrix after a failed probe without starting the normal scenario', async () => {
    mocks.fixture = 'test-edge-runtime.mjs';
    mocks.spawnSync.mockImplementation((_command, args) =>
      args[0].endsWith(mocks.fixture) ? { status: 1, stdout: 'private' } : { status: 0 },
    );
    mocks.exit.mockImplementation(() => {
      throw new Error('test-exit');
    });
    await expect(import('../run-runtime-matrix.mjs')).rejects.toThrow('test-exit');
    expect(
      mocks.spawnSync.mock.calls.filter(([, args]) => args[0].endsWith(mocks.fixture)),
    ).toHaveLength(1);
    expect(mocks.stdout.mock.calls.flat().join('')).not.toContain('Runtime matrix passed:');
  });
});

it('fails closed when an Auth fixture exits zero without explicit cleanup evidence', async () => {
  mocks.fixture = 'test-recovery-runtime.mjs';
  mocks.spawnSync.mockImplementation(() => ({ status: 0, stdout: 'private' }));
  mocks.exit.mockImplementation(() => {
    throw new Error('test-exit');
  });
  await expect(import('../run-runtime-matrix.mjs')).rejects.toThrow('test-exit');
  expect(mocks.exit).toHaveBeenCalledWith(1);
  expect(mocks.stderr.mock.calls.flat().join('')).toContain('cleanup evidence missing');
  expect(
    mocks.spawnSync.mock.calls.filter(([, args]) => args[0].endsWith(mocks.fixture)),
  ).toHaveLength(1);
});
