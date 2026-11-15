// @vitest-environment node
import assert from 'node:assert/strict';
import { readFileSync, writeSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  localStalePreflightDiagnostics,
  localStaleResourceDiagnostics,
} from './local-stale-preflight-diagnostics.mjs';
import { localStalePreflightStages, localStaleResourceStages } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal()),
  writeSync: vi.fn(),
}));

const privateValue = 'synthetic-private-preflight-material';
function recorder(enabled = true) {
  const lines = [];
  return {
    lines,
    mark: localStalePreflightDiagnostics({ enabled, write: (line) => lines.push(line) }),
  };
}

describe('local preflight diagnostic privacy', () => {
  it.each([false, true])('uses a synchronous caught default write, failure=%s', (failure) => {
    vi.mocked(writeSync).mockReset();
    if (failure)
      vi.mocked(writeSync).mockImplementation(() => {
        throw Error(privateValue);
      });
    const mark = localStalePreflightDiagnostics({ enabled: true });
    expect(() => mark('local-preflight-status', 'enter')).not.toThrow();
    expect(writeSync).toHaveBeenCalledExactlyOnceWith(
      1,
      'FEAT-003 runtime diagnostic: stage=local-preflight-status event=enter.\n',
    );
    vi.mocked(writeSync).mockReset();
  });
  it.each(localStalePreflightStages)('passes only fixed enter/pass vocabulary for %s', (stage) => {
    const { lines, mark } = recorder();
    mark(stage, 'enter', privateValue);
    mark(stage, 'passed', { message: privateValue });
    expect(lines).toEqual(
      ['enter', 'passed'].map(
        (event) => 'FEAT-003 runtime diagnostic: stage=' + stage + ' event=' + event + '.',
      ),
    );
    expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', lines.join('\n'))).toEqual(lines);
    expect(lines.join()).not.toContain(privateValue);
  });
  it('does not inspect or stringify untrusted values and rejects dynamic vocabulary', () => {
    const { lines, mark } = recorder();
    const unknown = new Proxy(
      {},
      {
        get() {
          throw Error('must not inspect');
        },
      },
    );
    for (const stage of [unknown, privateValue, 'local-preflight-status\n' + privateValue])
      mark(stage, 'enter');
    for (const event of [unknown, privateValue, 'failed', 'passed\n' + privateValue])
      mark('local-preflight-status', event);
    expect(lines).toEqual([]);
  });
  it('is silent by default and while disabled', () => {
    const write = vi.fn();
    localStalePreflightDiagnostics({ write })('local-preflight-status', 'enter');
    expect(write).not.toHaveBeenCalled();
    const { mark, lines } = recorder(false);
    mark('local-preflight-status', 'enter');
    expect(lines).toEqual([]);
  });
  it('cannot replace an operation failure when the diagnostic sink throws', () => {
    const mark = localStalePreflightDiagnostics({
      enabled: true,
      write() {
        throw Error(privateValue);
      },
    });
    const original = {
      get message() {
        throw Error('must not inspect');
      },
    };
    expect(() => {
      mark('local-preflight-status', 'enter');
      throw original;
    }).toThrow(original);
    expect(() => mark('local-preflight-status', 'passed')).not.toThrow();
  });
  it('does not manufacture completion or a cause for an unfinished stage', () => {
    const { lines, mark } = recorder();
    mark('local-preflight-status', 'enter');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/passed|failed|detail=/);
  });
});

// Execute only the existing preflight statements with synthetic stubs. No imports,
// CLI, database, Docker, network, credentials or runtime environment are executed.
const source = readFileSync(new URL('../test-feat-003-runtime.mjs', import.meta.url), 'utf8');
const preflightSource = source.slice(
  source.indexOf("preflight('local-preflight-configuration', 'enter');"),
  source.indexOf("preflight('local-preflight-context', 'enter');"),
);
async function simulatedPreflight(failing) {
  const { mark, lines } = recorder();
  const calls = [];
  const original = new Error(privateValue);
  const operation =
    (name, value) =>
    (...args) => {
      calls.push({ name, args });
      if (name === failing) throw original;
      return value;
    };
  const context = {
    preflight: mark,
    linkedMarkers: [],
    existsSync: () => false,
    readFileSync: operation('configuration', 'project_id = "synthetic"'),
    configPath: 'synthetic-config',
    localStaleReceipt: 'synthetic-receipt',
    localStaleTarget: undefined,
    verifyLocalStaleTarget: operation('target', {}),
    process: {
      cwd: () => 'synthetic-root',
      env: {},
      execPath: 'synthetic-node',
      argv: ['node', 'synthetic-fixture'],
    },
    path: { resolve: () => 'synthetic-root', dirname: () => 'synthetic-root' },
    fileURLToPath: () => 'synthetic-fixture',
    localStatus: operation('status', {
      API_URL: 'http://127.0.0.1:58321',
      DB_URL: 'postgresql://127.0.0.1:58322/postgres',
      PUBLISHABLE_KEY: privateValue,
      SERVICE_ROLE_KEY: privateValue,
    }),
    verifyLocalStaleEndpoints: operation('endpoints'),
    assertLoopbackUrl: (value) => new URL(value),
    localStaleContainer: () => 'synthetic-container',
    inspectDatabaseContainer: operation('database-container', {
      Name: '/supabase_db_synthetic',
      Config: { Labels: { 'com.supabase.cli.project': 'synthetic' } },
      HostConfig: { PortBindings: { '5432/tcp': [{ HostPort: '58322' }] } },
    }),
    assert,
    psql: operation('limiter-baseline', ''),
    spawnSync: operation('non-loopback-guard', { status: 0 }),
    commandTimeoutMs: 30000,
  };
  try {
    await runInNewContext(
      '(async () => {' +
        preflightSource.replaceAll('import.meta.url', "'synthetic-module'") +
        '})()',
      context,
    );
    return { calls, lines };
  } catch (error) {
    expect(error).toBe(original);
    return { calls, lines };
  }
}
describe('fixture preflight wiring with synthetic operations', () => {
  const operations = [
    'configuration',
    'target',
    'status',
    'endpoints',
    'database-container',
    'limiter-baseline',
    'non-loopback-guard',
  ];
  it('retains operation order, two baseline reads and the original child guard options', async () => {
    const { calls, lines } = await simulatedPreflight();
    expect(calls.map((call) => call.name)).toEqual([
      ...operations.slice(0, 6),
      'limiter-baseline',
      'non-loopback-guard',
    ]);
    expect(calls.at(-1).args).toEqual([
      'synthetic-node',
      ['synthetic-fixture', '--verify-non-loopback-guard'],
      { encoding: 'utf8', timeout: 30000, windowsHide: true },
    ]);
    expect(lines.at(-1)).toContain('stage=local-preflight-non-loopback-guard event=passed.');
    expect(lines.join()).not.toContain(privateValue);
  });
  it.each(operations)(
    'retains the failure and stops subsequent operations at %s',
    async (stage) => {
      const { calls, lines } = await simulatedPreflight(stage);
      expect(calls.map((call) => call.name)).toEqual(
        stage === 'non-loopback-guard'
          ? [...operations.slice(0, 6), 'limiter-baseline', 'non-loopback-guard']
          : operations.slice(0, operations.indexOf(stage) + 1),
      );
      expect(lines.at(-1)).toContain('stage=local-preflight-' + stage + ' event=enter.');
      expect(lines.join()).not.toContain(privateValue);
    },
  );
});

describe('failure-only resource cursor privacy', () => {
  it.each(localStaleResourceStages)('emits one fixed category for %s', (stage) => {
    const lines = [],
      observer = localStaleResourceDiagnostics({
        enabled: true,
        write: (line) => lines.push(line),
      });
    observer.mark(stage);
    expect(lines).toEqual([]);
    observer.fail(privateValue);
    observer.fail();
    expect(lines).toEqual([
      'FEAT-003 runtime diagnostic: stage=' + stage + ' event=failed detail=unclassified.',
    ]);
    expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', lines.join('\n'))).toEqual(lines);
    expect(lines.join()).not.toContain(privateValue);
  });
  it('does not stringify unknown categories, retain stale attribution or report cleared checks', () => {
    const lines = [],
      observer = localStaleResourceDiagnostics({
        enabled: true,
        write: (line) => lines.push(line),
      });
    const unknown = new Proxy(
      {},
      {
        get() {
          throw Error('must not inspect');
        },
      },
    );
    for (const stage of [unknown, privateValue, 'local-resource-db-name\n' + privateValue]) {
      observer.mark('local-resource-db-name');
      observer.mark(stage);
      observer.fail();
    }
    observer.mark('local-resource-db-name');
    observer.clear();
    observer.fail();
    expect(lines).toEqual([]);
  });
  it('is silent by default, including the failure path', () => {
    const write = vi.fn(),
      observer = localStaleResourceDiagnostics({ write });
    observer.mark('local-resource-db-name');
    observer.fail();
    expect(write).not.toHaveBeenCalled();
  });
  it('catches default FD write failure and clears the cursor', () => {
    vi.mocked(writeSync)
      .mockReset()
      .mockImplementation(() => {
        throw Error(privateValue);
      });
    const observer = localStaleResourceDiagnostics({ enabled: true });
    observer.mark('local-resource-db-name');
    expect(() => observer.fail()).not.toThrow();
    observer.fail();
    expect(writeSync).toHaveBeenCalledTimes(1);
    vi.mocked(writeSync).mockReset();
  });
});
