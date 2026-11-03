import { createHash } from 'node:crypto';
import { feat003StagingTarget } from '../../config/feat-003-staging-target.mjs';
import { validateFeat003StagingPreflight } from './feat-003-staging-preflight.mjs';

const fields = [
  'organizationId',
  'eligibleUserId',
  'grantId',
  'sourceInstanceId',
  'issuanceCorrelationId',
];
const settings = ['organization_id', 'user_id', 'grant_id', 'source_id', 'correlation_id'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const plans = new WeakSet();
const reject = () => {
  throw new Error('FEAT-003 staging issuance rejected.');
};

export function prepareStagingGrant(input, transactionText) {
  try {
    validateFeat003StagingPreflight(
      input.manifestText,
      input.packageText,
      input.reviewText,
      input.artifacts,
      input.checkoutRevision,
    );
    const configuration = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Map.prototype.get.call(input.artifacts, 'configuration'),
      ),
    );
    const request = configuration.stagingGrant;
    if (
      !request ||
      Object.keys(request).length !== fields.length + 1 ||
      !fields.every(
        (key) =>
          Object.hasOwn(request, key) &&
          typeof request[key] === 'string' &&
          uuid.test(request[key]),
      ) ||
      request.transactionSha256 !== createHash('sha256').update(transactionText).digest('hex') ||
      new Set(fields.map((key) => request[key])).size !== fields.length ||
      typeof configuration.stagingGrantToolSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(configuration.stagingGrantToolSha256)
    )
      reject();
    const variables = fields
      .map((key, index) => `set local flyeye.issuer_${settings[index]} = '${request[key]}';`)
      .join('\n');
    const plan = Object.freeze({
      sql: `begin;\nset local statement_timeout = '15s';\nset local lock_timeout = '5s';\n${variables}\n${transactionText}\ncommit;\nselect 'FLYEYE_STAGING_GRANT_COMMITTED';\n`,
      approvalReference: JSON.parse(input.packageText).approvals.deployment,
      toolSha256: configuration.stagingGrantToolSha256,
    });
    plans.add(plan);
    return plan;
  } catch {
    reject();
  }
}

// This describes only a reviewed command; it never accesses credentials or executes it.
export function stagingGrantCommand(plan) {
  if (!plans.has(plan)) reject();
  return Object.freeze({
    command: 'psql',
    args: Object.freeze([
      '-X',
      '-W',
      '-A',
      '-t',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=sqlstate',
      '-d',
      `host=${feat003StagingTarget.databaseHost} port=5432 dbname=postgres user=postgres sslmode=verify-full sslrootcert=system connect_timeout=10`,
    ]),
    input: plan.sql,
  });
}

export function classifyStagingGrantResult(result) {
  if (
    !result?.error &&
    !result?.signal &&
    result?.status === 0 &&
    result?.stdout?.trim() === 'FLYEYE_STAGING_GRANT_COMMITTED'
  )
    return 'issued';
  // Nonzero status can follow a committed transaction whose acknowledgement was lost.
  // No raw child output, guessed rollback claim, or automatic retry is safe here.
  return 'uncertain';
}
