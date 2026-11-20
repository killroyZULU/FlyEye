import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { feat003StagingTarget } from '../../config/feat-003-staging-target.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sql = readFileSync(new URL('../sql/feat-003-staging-grant.sql', import.meta.url), 'utf8');
const manifestText = readFileSync(
  new URL('../../config/feat-003-staging-environment.json', import.meta.url),
  'utf8',
);
const tool = Buffer.from('Synthetic tool bytes; never an executable.');

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

export { fixture, hash, sql, tool };
