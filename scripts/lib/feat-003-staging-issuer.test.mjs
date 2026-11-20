// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { fixture, hash, sql, tool } from './staging-package-test-data.mjs';
import { describe, expect, it, vi } from 'vitest';
import { feat003StagingTarget } from '../../config/feat-003-staging-target.mjs';
import { generateStagingBrowserConfiguration } from './feat-003-staging-browser-package.mjs';
import { reconcilePackagedStagingAccounts } from './feat-003-staging-account-package.mjs';
import { completed, fixture as emptyLedger } from './staging-account-test-data.mjs';
import {
  prepareStagingGrant,
  stagingGrantCommand,
  classifyStagingGrantResult,
} from './feat-003-staging-issuer.mjs';
import { executeStagingGrant } from './feat-003-staging-issuer-command.mjs';

const rejection = 'FEAT-003 staging issuance rejected.';
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
  it('reconciles the three retained identities only with their reviewed package and public browser selection', () => {
    const { configuration, input, rebind } = fixture();
    const accounts = completed();
    const selection = {
      publishableKey: 'sb_publishable_synthetic-development-key',
      callbackPaths: [],
    };
    configuration.browser = JSON.parse(generateStagingBrowserConfiguration(selection));
    const admin = accounts.ledger.slots.find((slot) => slot.role === 'admin');
    Object.assign(configuration.stagingGrant, {
      organizationId: accounts.ledger.schoolId,
      eligibleUserId: admin.authId,
      grantId: admin.grantId,
      sourceInstanceId: accounts.view.slots[2].grant.issuanceAttemptId,
      issuanceCorrelationId: accounts.view.slots[2].grant.provenance.correlationId,
    });
    rebind();
    const check = (selected = selection) =>
      reconcilePackagedStagingAccounts(
        input,
        selected,
        JSON.stringify(accounts.ledger),
        JSON.stringify(accounts.view),
        sql,
      );
    expect(check()).toEqual({
      decision: 'plan',
      slots: {
        student_pilot: { decision: 'already-complete' },
        instructor_pilot: { decision: 'already-complete' },
        admin: { decision: 'already-complete' },
      },
    });
    const fresh = emptyLedger();
    expect(
      reconcilePackagedStagingAccounts(
        input,
        selection,
        JSON.stringify(fresh.ledger),
        JSON.stringify(fresh.view),
        sql,
      ).slots.admin,
    ).toEqual({
      decision: 'create',
      step: 'record-intent-before-auth',
      plannedAuthId: admin.authId,
    });
    const coercion = vi.fn(() => {
      throw new Error('Unsafe byte conversion');
    });
    Object.defineProperty(input.artifacts.get('configuration'), 'valueOf', { value: coercion });
    expect(check().decision).toBe('plan');
    expect(coercion).not.toHaveBeenCalled();
    const rejection = { decision: 'stop', reason: 'package-conflict' };
    // A validly rehashed package cannot reserve another fixture's Auth ID for the first Admin.
    fresh.ledger.slots[0] = accounts.ledger.slots[0];
    fresh.view.slots[0] = accounts.view.slots[0];
    for (const id of [fresh.ledger.slots[0].authId, fresh.ledger.slots[0].operationId]) {
      configuration.stagingGrant.eligibleUserId = id;
      rebind();
      expect(
        reconcilePackagedStagingAccounts(
          input,
          selection,
          JSON.stringify(fresh.ledger),
          JSON.stringify(fresh.view),
          sql,
        ),
      ).toEqual(rejection);
    }
    configuration.stagingGrant.eligibleUserId = admin.authId;
    rebind();
    expect(check({ ...selection, callbackPaths: ['/auth/recovery'] })).toEqual(rejection);
    for (const field of [
      'organizationId',
      'eligibleUserId',
      'grantId',
      'sourceInstanceId',
      'issuanceCorrelationId',
      'transactionSha256',
    ]) {
      const original = configuration.stagingGrant[field];
      configuration.stagingGrant[field] = randomUUID();
      rebind();
      expect(check()).toEqual(rejection);
      configuration.stagingGrant[field] = original;
    }
    delete configuration.stagingGrantToolSha256;
    rebind();
    expect(check()).toEqual(rejection);
    configuration.stagingGrantToolSha256 = hash(tool);
    rebind();
    input.artifacts.set('configuration', Buffer.from('{}'));
    expect(check()).toEqual(rejection);
  });
  it('binds generated browser settings alongside grant metadata in the reviewed P1 artifact', () => {
    const { configuration, input, rebind } = fixture();
    const publishableKey = 'sb_publishable_synthetic-development-key';
    configuration.browser = JSON.parse(
      generateStagingBrowserConfiguration({ publishableKey, callbackPaths: [] }),
    );
    rebind();
    expect(() => prepareStagingGrant(input, sql)).not.toThrow();
    input.artifacts.set(
      'configuration',
      Buffer.from(JSON.stringify({ ...configuration, browser: {} })),
    );
    expect(() => prepareStagingGrant(input, sql)).toThrow(rejection);
  });
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
