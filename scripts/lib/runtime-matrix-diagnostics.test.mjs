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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mocks.fixture = 'test-feat-006b-runtime.mjs';
  vi.resetAllMocks();
  vi.resetModules();
});

describe('SEC-033 readiness diagnostics', () => {
  const privateText = 'synthetic-private-url-token-email';
  const output = () => [...mocks.stdout.mock.calls, ...mocks.stderr.mock.calls].flat().join('');
  const children = () =>
    mocks.spawnSync.mock.calls.filter(([, args]) => args[0].endsWith(mocks.fixture));
  const probes = () => mocks.spawnSync.mock.calls.filter(([command]) => command === 'docker');
  const lifecycle = () =>
    mocks.spawnSync.mock.calls.filter(([, args]) => ['stop', 'start'].includes(args[1]));

  async function runTimedMatrix() {
    const wait = vi.fn((callback) => {
      queueMicrotask(callback);
      return 0;
    });
    vi.stubGlobal('setTimeout', wait);
    try {
      await import('../run-runtime-matrix.mjs');
    } catch (error) {
      return error;
    } finally {
      const sequences = mocks.stdout.mock.calls.filter(([line]) =>
        line.includes('phase=template'),
      ).length;
      expect(wait).toHaveBeenCalledTimes(probes().length - sequences);
      for (const [, delay] of wait.mock.calls) expect(delay).toBe(250);
    }
  }

  for (const phase of ['stop', 'start']) {
    it.each([
      ['timeout', { status: null, error: { code: 'ETIMEDOUT', message: privateText } }],
      ['spawn-error', { status: null, error: { code: privateText, message: privateText } }],
      ['signal', { status: null, signal: privateText }],
      ['nonzero-exit', { status: 1 }],
      ['unknown', { status: null }],
    ])(`reports ${phase} %s without probing or launching a fixture`, async (outcome, result) => {
      mocks.spawnSync.mockImplementation((_command, args) =>
        args[1] === phase ? { ...result, stdout: privateText, stderr: privateText } : { status: 0 },
      );
      mocks.exit.mockImplementation(() => {
        throw new Error('test-exit');
      });
      await expect(import('../run-runtime-matrix.mjs')).rejects.toThrow('test-exit');
      expect(output()).toContain(
        `fixture=FEAT-006B mode=0 phase=${phase} outcome=${outcome} attempts=1.`,
      );
      expect(output()).toContain(`could not ${phase} cleanly`);
      expect(output()).not.toContain(privateText);
      expect(probes()).toHaveLength(0);
      expect(children()).toHaveLength(0);
      expect(lifecycle().map(([, args]) => args[1])).toEqual(
        phase === 'stop' ? ['stop'] : ['stop', 'start'],
      );
      for (const [, args, options] of lifecycle()) {
        expect(args).toHaveLength(2);
        expect(options).toEqual({
          stdio: 'ignore',
          timeout: args[1] === 'stop' ? 120_000 : 180_000,
          windowsHide: true,
        });
      }
    });
  }

  it.each([
    ['timeout', { status: null, error: { code: 'ETIMEDOUT', message: privateText } }],
    ['spawn-error', { status: null, error: { code: privateText } }],
    ['signal', { status: null, signal: privateText }],
    ['nonzero-exit', { status: 8 }],
    ['unknown', { status: null }],
  ])('reports exhausted template probes with last outcome %s', async (outcome, result) => {
    mocks.spawnSync.mockImplementation((command) =>
      command === 'docker'
        ? { ...result, stdout: privateText, stderr: privateText }
        : { status: 0 },
    );
    mocks.exit.mockImplementation(() => {
      throw new Error('test-exit');
    });
    expect((await runTimedMatrix()).message).toBe('test-exit');
    expect(output()).toContain(`phase=template outcome=${outcome} attempts=80.`);
    expect(output()).toContain('the local Auth template route remained unavailable');
    expect(output()).not.toContain(privateText);
    expect(probes()).toHaveLength(80);
    expect(children()).toHaveLength(0);
    expect(lifecycle().map(([, args]) => args[1])).toEqual(['stop', 'start']);
    for (const [, args, options] of probes()) {
      expect(args).toEqual([
        'exec',
        'supabase_auth_flyeye',
        'sh',
        '-c',
        'wget -q -O /dev/null "$GOTRUE_MAILER_TEMPLATES_RECOVERY"',
      ]);
      expect(options).toEqual({ stdio: 'ignore', timeout: 5_000, windowsHide: true });
    }
  });

  it('stops probing at the first success without another lifecycle call', async () => {
    let attempts = 0;
    mocks.spawnSync.mockImplementation((command) => ({
      status: command === 'docker' && ++attempts < 3 ? 1 : 0,
      stdout: 'FEAT-006B runtime diagnostic: stage=fixture-cleanup event=passed.',
    }));
    expect(await runTimedMatrix()).toBeUndefined();
    expect(probes()).toHaveLength(3);
    expect(children()).toHaveLength(1);
    expect(lifecycle()).toHaveLength(2);
    expect(output()).toContain('phase=template outcome=success attempts=3.');
  });

  it('preserves the recovery preflight of 20 probes before its existing restart', async () => {
    mocks.fixture = 'test-recovery-runtime.mjs';
    let attempts = 0;
    mocks.spawnSync.mockImplementation((command) => ({
      status: command === 'docker' && ++attempts <= 20 ? 1 : 0,
      stdout: 'FEAT-002 runtime diagnostic: stage=fixture-cleanup event=passed.',
    }));
    expect(await runTimedMatrix()).toBeUndefined();
    expect(probes()).toHaveLength(21);
    expect(children()).toHaveLength(2);
    expect(lifecycle().map(([, args]) => args[1])).toEqual(['stop', 'start']);
    expect(output()).toContain(
      'fixture=FEAT-002 mode=0 phase=template outcome=nonzero-exit attempts=20.',
    );
    expect(output()).toContain(
      'fixture=FEAT-002 mode=0 phase=template outcome=success attempts=1.',
    );
  });

  it('identifies the pending mode and never launches it after readiness failure', async () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    mocks.fixture = 'test-feat-004-runtime.mjs';
    let starts = 0;
    mocks.spawnSync.mockImplementation((_command, args) => ({
      status: args[1] === 'start' && ++starts === 2 ? 1 : 0,
      stdout: 'FEAT-004 runtime diagnostic: stage=fixture-cleanup event=passed.',
    }));
    mocks.exit.mockImplementation(() => {
      throw new Error('test-exit');
    });
    await expect(import('../run-runtime-matrix.mjs')).rejects.toThrow('test-exit');
    expect(output()).toContain(
      'fixture=FEAT-004 mode=1 phase=start outcome=nonzero-exit attempts=1.',
    );
    expect(children()).toHaveLength(1);
    expect(children()[0][1]).toContain('--recipient-cleanup-probe');
    expect(probes()).toHaveLength(1);
  });
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

describe('R2 member MFA browser gate', () => {
  it('preserves API mode and runs interrupted, fresh and resume browser modes', async () => {
    mocks.fixture = 'test-feat-006-runtime.mjs';
    const line = 'FEAT-006 runtime diagnostic: stage=fixture-cleanup event=passed.';
    mocks.spawnSync.mockImplementation(() => ({ status: 0, stdout: `${line}\nprivate-token` }));
    await import('../run-runtime-matrix.mjs');
    const children = mocks.spawnSync.mock.calls.filter(([, args]) =>
      args[0].endsWith(mocks.fixture),
    );
    expect(children.map(([, args]) => args.slice(1))).toEqual([
      [],
      ['--browser', '--cleanup-probe'],
      ['--browser'],
      ['--browser', '--resume'],
    ]);
    for (const child of children) expect(child[2].stdio).toEqual(['ignore', 'pipe', 'ignore']);
    expect(mocks.stdout.mock.calls.flat().join('')).not.toContain('private-token');
  });

  it('stops after a zero-exit browser probe without cleanup evidence', async () => {
    mocks.fixture = 'test-feat-006-runtime.mjs';
    mocks.spawnSync.mockImplementation((_command, args) => ({
      status: 0,
      stdout: args.includes('--browser')
        ? ''
        : 'FEAT-006 runtime diagnostic: stage=fixture-cleanup event=passed.',
    }));
    mocks.exit.mockImplementation(() => {
      throw new Error('test-exit');
    });
    await expect(import('../run-runtime-matrix.mjs')).rejects.toThrow('test-exit');
    expect(
      mocks.spawnSync.mock.calls.filter(([, args]) => args[0].endsWith(mocks.fixture)),
    ).toHaveLength(2);
    expect(mocks.stderr.mock.calls.flat().join('')).toContain('cleanup evidence missing');
  });
});

describe('R3 provider consistency gate', () => {
  it('runs current-factor cases first while retaining every mode and cleanup-gated restart', async () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    mocks.fixture = 'test-feat-003-runtime.mjs';
    const line = 'FEAT-003 runtime diagnostic: stage=fixture-cleanup event=passed.';
    mocks.spawnSync.mockImplementation(() => ({
      status: 0,
      stdout: `${line}\nprivate-factor-token`,
    }));
    await import('../run-runtime-matrix.mjs');
    const children = mocks.spawnSync.mock.calls.filter(([, args]) =>
      args[0].endsWith(mocks.fixture),
    );
    expect(children.map(([, args]) => args.slice(1))).toEqual([
      ['--current-factor-cleanup-probe'],
      ['--current-factor'],
      ['--uncertainty-cleanup-probe'],
      ['--provider-uncertainty'],
      ['--churn-cleanup-probe'],
      ['--factor-churn'],
      [],
      ['--provider-cleanup-probe'],
      ['--provider-state'],
      ['--stale-cleanup-probe'],
      ['--stale-factors'],
      ['--challenge-cleanup-probe'],
      ['--verified-challenge'],
    ]);
    expect(mocks.stdout.mock.calls.flat().join('')).not.toContain('private-factor-token');
    const lifecycle = mocks.spawnSync.mock.calls
      .map(([, args]) => (args[0].endsWith(mocks.fixture) ? 'fixture' : args[1]))
      .filter((value) => ['stop', 'start', 'fixture'].includes(value));
    expect(lifecycle).toEqual(
      Array.from({ length: 13 }, () => ['stop', 'start', 'fixture']).flat(),
    );
  });
  it.each([
    ['--current-factor-cleanup-probe', 0, 1],
    ['--current-factor-cleanup-probe', 1, 1],
    ['--current-factor', 0, 2],
    ['--current-factor', 1, 2],
    ['--uncertainty-cleanup-probe', 0, 3],
    ['--uncertainty-cleanup-probe', 1, 3],
    ['--provider-uncertainty', 0, 4],
    ['--provider-uncertainty', 1, 4],
    ['--churn-cleanup-probe', 0, 5],
    ['--churn-cleanup-probe', 1, 5],
    ['--factor-churn', 0, 6],
    ['--factor-churn', 1, 6],
    ['--provider-cleanup-probe', 0, 8],
    ['--provider-cleanup-probe', 1, 8],
    ['--stale-cleanup-probe', 0, 10],
    ['--stale-cleanup-probe', 1, 10],
    ['--challenge-cleanup-probe', 0, 12],
    ['--challenge-cleanup-probe', 1, 12],
  ])(
    'blocks restart and further cases on %s exit %s without sufficient success evidence',
    async (probe, exitCode, count) => {
      vi.stubEnv('CI', 'true');
      vi.stubEnv('GITHUB_ACTIONS', 'true');
      mocks.fixture = 'test-feat-003-runtime.mjs';
      mocks.spawnSync.mockImplementation((_command, args) => ({
        status: args.includes(probe) ? exitCode : 0,
        stdout:
          args.includes(probe) && exitCode === 0
            ? ''
            : 'FEAT-003 runtime diagnostic: stage=fixture-cleanup event=passed.',
      }));
      mocks.exit.mockImplementation(() => {
        throw new Error('test-exit');
      });
      await expect(import('../run-runtime-matrix.mjs')).rejects.toThrow('test-exit');
      expect(
        mocks.spawnSync.mock.calls.filter(([, args]) => args[0].endsWith(mocks.fixture)),
      ).toHaveLength(count);
      expect(mocks.spawnSync.mock.calls.filter(([, args]) => args[1] === 'stop')).toHaveLength(
        count,
      );
    },
  );
  it('keeps non-CI onboarding on its existing single mode without additional lifecycle calls', async () => {
    vi.stubEnv('CI', 'false');
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    mocks.fixture = 'test-feat-003-runtime.mjs';
    mocks.spawnSync.mockImplementation(() => ({
      status: 0,
      stdout: 'FEAT-003 runtime diagnostic: stage=fixture-cleanup event=passed.',
    }));
    await import('../run-runtime-matrix.mjs');
    expect(
      mocks.spawnSync.mock.calls.filter(([, args]) => args[0].endsWith(mocks.fixture)),
    ).toHaveLength(1);
    expect(mocks.spawnSync.mock.calls.filter(([, args]) => args[1] === 'stop')).toHaveLength(1);
  });
  it('stops before the next mode when the between-mode lifecycle fails', async () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    mocks.fixture = 'test-feat-003-runtime.mjs';
    let stops = 0;
    mocks.spawnSync.mockImplementation((_command, args) => ({
      status: args[1] === 'stop' && ++stops === 2 ? 1 : 0,
      stdout: 'FEAT-003 runtime diagnostic: stage=fixture-cleanup event=passed.',
    }));
    mocks.exit.mockImplementation(() => {
      throw new Error('test-exit');
    });
    await expect(import('../run-runtime-matrix.mjs')).rejects.toThrow('test-exit');
    expect(
      mocks.spawnSync.mock.calls.filter(([, args]) => args[0].endsWith(mocks.fixture)),
    ).toHaveLength(1);
  });
});

it('retains invitation-list substages while suppressing private child output and stopping on failure', async () => {
  mocks.fixture = 'test-feat-004-runtime.mjs';
  const diagnostic =
    'FEAT-004 runtime diagnostic: stage=invitation-list-decode event=failed detail=transport-socket-closed.';
  mocks.spawnSync.mockImplementation((_command, args) => ({
    status: args[0].endsWith(mocks.fixture) ? 1 : 0,
    stdout: `${diagnostic}\nFEAT-004 runtime diagnostic: stage=fixture-cleanup event=passed.\nsynthetic-private-body-token`,
  }));
  mocks.exit.mockImplementation(() => {
    throw new Error('test-exit');
  });
  await expect(import('../run-runtime-matrix.mjs')).rejects.toThrow('test-exit');
  const output = [...mocks.stdout.mock.calls, ...mocks.stderr.mock.calls].flat().join('');
  expect(output).toContain(diagnostic);
  expect(output).not.toContain('synthetic-private-body-token');
  expect(mocks.exit).toHaveBeenCalledWith(1);
  expect(
    mocks.spawnSync.mock.calls.filter(([, args]) => args[0].endsWith(mocks.fixture)),
  ).toHaveLength(1);
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
