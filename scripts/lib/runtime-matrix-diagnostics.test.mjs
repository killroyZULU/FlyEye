import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  stdout: vi.fn(),
  stderr: vi.fn(),
  exit: vi.fn(),
}));
vi.mock('node:fs', () => {
  const fs = { readdirSync: () => [{ isFile: () => true, name: 'test-feat-006b-runtime.mjs' }] };
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
