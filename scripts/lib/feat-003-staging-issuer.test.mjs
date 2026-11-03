// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { feat003StagingTarget } from '../../config/feat-003-staging-target.mjs';
import {
  prepareStagingGrant,
  stagingGrantCommand,
  classifyStagingGrantResult,
} from './feat-003-staging-issuer.mjs';
import { executeStagingGrant } from './feat-003-staging-issuer-command.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sql = readFileSync(new URL('../sql/feat-003-staging-grant.sql', import.meta.url), 'utf8');
const manifestText = readFileSync(
  new URL('../../config/feat-003-staging-environment.json', import.meta.url),
  'utf8',
);
const tool = Buffer.from('Synthetic tool bytes; never an executable.');
const rejection = 'FEAT-003 staging issuance rejected.';

function fixture() {
  const configuration = {
    stagingGrant: {
      ...Object.fromEntries(
        [
          'organizationId',
          'eligibleUserId',
          'grantId',
          'sourceInstanceId',
          'issuanceCorrelationId',
        ].map((key) => [key, randomUUID()]),
      ),
      transactionSha256: hash(sql),
    },
    stagingGrantToolSha256: hash(tool),
  };
  const artifacts = new Map(
    ['configuration', 'edge', 'frontend', 'lockfile', 'migrations'].map((key) => [
      key,
      Buffer.from(key === 'configuration' ? JSON.stringify(configuration) : `Synthetic ${key}`),
    ]),
  );
  const run = {
    schemaVersion: 1,
    environment: 'staging',
    dataClassification: 'synthetic-only',
    target: { ...feat003StagingTarget },
    sourceRevision: 'a'.repeat(40),
    manifestSha256: hash(manifestText),
    artifacts: [],
    operations: [
      'migrations',
      'configuration',
      'functions',
      'fixtures',
      'frontend',
      'checkpoint',
      'redeployment',
    ],
    approvals: { creation: 'synthetic-creation', deployment: 'synthetic-deployment' },
  };
  const input = { manifestText, artifacts, checkoutRevision: run.sourceRevision };
  const rebind = () => {
    artifacts.set('configuration', Buffer.from(JSON.stringify(configuration)));
    run.artifacts = [...artifacts].map(([name, bytes]) => ({ name, sha256: hash(bytes) }));
    input.packageText = JSON.stringify(run);
    input.reviewText = JSON.stringify({
      schemaVersion: 1,
      target: run.target,
      sourceRevision: run.sourceRevision,
      packageSha256: hash(input.packageText),
      approvals: run.approvals,
    });
  };
  rebind();
  return { input, configuration, run, rebind };
}
function operator() {
  return {
    isInteractive: vi.fn(() => true),
    readTool: vi.fn(async () => tool),
    cleanCheckout: vi.fn(() => true),
    supportedTool: vi.fn(() => true),
    confirm: vi.fn(async () => 'synthetic-deployment'),
    run: vi.fn(() => ({ status: 0, stdout: 'FLYEYE_STAGING_GRANT_COMMITTED\n' })),
  };
}

describe('P3b staging issuer', () => {
  it('runs exactly once only after complete review, tool, checkout and owner gates', async () => {
    const { input } = fixture();
    const op = operator();
    expect(await executeStagingGrant(input, sql, op)).toBe('issued');
    expect(op.run).toHaveBeenCalledTimes(1);
    const order = Object.values(op).map((callback) => callback.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const command = op.run.mock.calls[0][0];
    expect(command.command).toBe('psql');
    expect(command.args).toContain('-W');
    expect(command.args).toContain('-X');
    expect(command.args.at(-1)).toContain(`host=${feat003StagingTarget.databaseHost}`);
    expect(command.args.at(-1)).toContain('sslmode=verify-full sslrootcert=system');
    expect(command.args.join(' ')).not.toMatch(/password=|postgres:\/\//i);
    expect(command.input).toContain(sql);
    expect(command.input).toContain('commit;');
  });
  it.each(['manifest', 'target', 'revision', 'artifact', 'approval', 'review'])(
    'rejects %s mismatch before every operator capability',
    async (kind) => {
      const { input, run, rebind } = fixture();
      const op = operator();
      if (kind === 'manifest') input.manifestText = '{}';
      if (kind === 'target') {
        run.target.projectRef = 'x'.repeat(20);
        rebind();
      }
      if (kind === 'revision') input.checkoutRevision = 'b'.repeat(40);
      if (kind === 'artifact') input.artifacts.set('edge', Buffer.from('changed'));
      if (kind === 'approval') {
        run.approvals.deployment = run.approvals.creation;
        rebind();
      }
      if (kind === 'review') input.reviewText = '{}';
      await expect(executeStagingGrant(input, sql, op)).rejects.toThrow(rejection);
      for (const callback of Object.values(op)) expect(callback).not.toHaveBeenCalled();
    },
  );
  it.each([
    'missing',
    'extra',
    'malformed',
    'duplicate',
    'sql-digest',
    'tool-digest',
    'uuid-array',
    'uuid-number',
    'tool-array',
    'duplicate-array',
  ])('rejects %s issuer request before capability access', async (kind) => {
    const f = fixture();
    const op = operator();
    const request = f.configuration.stagingGrant;
    if (kind === 'missing') delete request.eligibleUserId;
    if (kind === 'extra') request.humanActor = randomUUID();
    if (kind === 'malformed') request.organizationId = "'; malicious SQL";
    if (kind === 'duplicate') request.grantId = request.organizationId;
    if (kind === 'sql-digest') request.transactionSha256 = '0'.repeat(64);
    if (kind === 'tool-digest') delete f.configuration.stagingGrantToolSha256;
    if (kind === 'uuid-array') request.organizationId = [request.organizationId];
    if (kind === 'uuid-number') request.organizationId = 1234;
    if (kind === 'tool-array') f.configuration.stagingGrantToolSha256 = [hash(tool)];
    if (kind === 'duplicate-array') request.grantId = [request.organizationId];
    f.rebind();
    await expect(executeStagingGrant(f.input, sql, op)).rejects.toThrow(rejection);
    for (const callback of Object.values(op)) expect(callback).not.toHaveBeenCalled();
  });
  it('invalidates request-only changes under the prior artifact approval', async () => {
    const f = fixture();
    f.configuration.stagingGrant.eligibleUserId = randomUUID();
    f.input.artifacts.set('configuration', Buffer.from(JSON.stringify(f.configuration)));
    await expect(executeStagingGrant(f.input, sql, operator())).rejects.toThrow(rejection);
  });
  it('uses native Map access rather than a supplied get override', () => {
    const f = fixture();
    f.input.artifacts.get = () => {
      throw new Error('Override called');
    };
    expect(() => prepareStagingGrant(f.input, sql)).not.toThrow();
  });
  it('does not accept a forged execution plan', () => {
    expect(() => stagingGrantCommand({ sql: 'arbitrary SQL' })).toThrow(rejection);
  });
  it.each(['terminal', 'binary', 'dirty', 'version', 'confirmation'])(
    'denies %s before database execution',
    async (kind) => {
      const f = fixture();
      const op = operator();
      if (kind === 'terminal') op.isInteractive.mockReturnValue(false);
      if (kind === 'binary') op.readTool.mockResolvedValue(Buffer.from('other tool'));
      if (kind === 'dirty') op.cleanCheckout.mockReturnValue(false);
      if (kind === 'version') op.supportedTool.mockReturnValue(false);
      if (kind === 'confirmation') op.confirm.mockResolvedValue('different approval');
      await expect(executeStagingGrant(f.input, sql, op)).rejects.toThrow(rejection);
      expect(op.run).not.toHaveBeenCalled();
    },
  );
  it.each([
    { status: 3, stderr: 'sensitive provider data' },
    { status: 0, stdout: 'raw data' },
    { status: null, error: new Error('secret detail') },
    { status: 0, signal: 'SIGTERM' },
  ])('reports uncertain transport without retry or raw output', async (result) => {
    const f = fixture();
    const op = operator();
    op.run.mockReturnValue(result);
    expect(await executeStagingGrant(f.input, sql, op)).toBe('uncertain');
    expect(op.run).toHaveBeenCalledTimes(1);
    expect(classifyStagingGrantResult(result)).toBe('uncertain');
  });
  it('contains thrown transport errors and never retries', async () => {
    const op = operator();
    op.run.mockImplementation(() => {
      throw new Error('secret detail');
    });
    expect(await executeStagingGrant(fixture().input, sql, op)).toBe('uncertain');
    expect(op.run).toHaveBeenCalledTimes(1);
  });
});
