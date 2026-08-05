const exactKeys = [
  'apiOrigin',
  'dataClassification',
  'databaseHost',
  'enabled',
  'environment',
  'frontendOrigin',
  'limiterPolicyVersion',
  'projectRef',
  'schemaVersion',
];

const projectRefPattern = /^[a-z0-9]{20}$/;
const databaseHostPattern = /^[a-z0-9.-]+$/;

function exactHttpsOrigin(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is required.`);

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is invalid.`);
  }

  if (
    url.protocol !== 'https:' ||
    url.origin !== value ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must be one exact HTTPS origin.`);
  }

  return url;
}

export function parseFeat003StagingManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('The staging manifest must be an object.');
  }

  const keys = Object.keys(input).sort();
  if (keys.length !== exactKeys.length || keys.some((key, index) => key !== exactKeys[index])) {
    throw new Error('The staging manifest fields are invalid.');
  }

  if (input.schemaVersion !== 1) throw new Error('The staging manifest version is unsupported.');
  if (input.environment !== 'staging') throw new Error('The environment must be staging.');
  if (input.dataClassification !== 'synthetic-only') {
    throw new Error('The staging manifest must remain synthetic-only.');
  }
  if (input.limiterPolicyVersion !== 'subject-action-v1') {
    throw new Error('The limiter policy version is unsupported.');
  }
  if (typeof input.enabled !== 'boolean') throw new Error('The enabled flag is invalid.');

  if (!input.enabled) {
    for (const field of ['projectRef', 'apiOrigin', 'databaseHost', 'frontendOrigin']) {
      if (input[field] !== null) {
        throw new Error('A disabled staging manifest cannot name a provider target.');
      }
    }
    return { enabled: false };
  }

  if (typeof input.projectRef !== 'string' || !projectRefPattern.test(input.projectRef)) {
    throw new Error('The staging project reference is invalid.');
  }

  const apiOrigin = exactHttpsOrigin(input.apiOrigin, 'The staging API origin');
  const frontendOrigin = exactHttpsOrigin(input.frontendOrigin, 'The staging frontend origin');
  if (apiOrigin.hostname !== `${input.projectRef}.supabase.co`) {
    throw new Error('The staging API origin does not match the project reference.');
  }
  if (typeof input.databaseHost !== 'string' || !databaseHostPattern.test(input.databaseHost)) {
    throw new Error('The staging database host is invalid.');
  }
  if (input.databaseHost !== `db.${input.projectRef}.supabase.co`) {
    throw new Error('The staging database host does not match the project reference.');
  }
  if (frontendOrigin.hostname.endsWith('.supabase.co')) {
    throw new Error('The staging frontend origin must be separate from the Supabase API origin.');
  }

  return {
    enabled: true,
    projectRef: input.projectRef,
    apiOrigin: apiOrigin.origin,
    databaseHost: input.databaseHost,
    frontendOrigin: frontendOrigin.origin,
    dataClassification: input.dataClassification,
    limiterPolicyVersion: input.limiterPolicyVersion,
  };
}

function functionSection(config, functionName) {
  const escapedName = functionName.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^\\[functions\\.${escapedName}\\]\\r?\\n(?:(?!^\\[)[\\s\\S])*?^verify_jwt\\s*=\\s*true\\s*$`,
    'm',
  ).test(config);
}

export function validateFeat003RepositoryConfiguration(config, edgeEnvironmentExample) {
  if (
    typeof config !== 'string' ||
    !functionSection(config, 'auth-bootstrap') ||
    !functionSection(config, 'organization-admin-onboarding')
  ) {
    throw new Error('Protected FEAT-003 function configuration is invalid.');
  }

  const expectedExampleLines = [
    'ALLOWED_ORIGIN=http://127.0.0.1:5173',
    'FLYEYE_RUNTIME_PROFILE=local-synthetic-v1',
    'FEAT003_LIMITER_POLICY_VERSION=subject-action-v1',
    'FEAT003_DATA_CLASSIFICATION=synthetic-only',
  ];
  if (
    typeof edgeEnvironmentExample !== 'string' ||
    expectedExampleLines.some((line) => !edgeEnvironmentExample.split(/\r?\n/).includes(line))
  ) {
    throw new Error('The FEAT-003 Edge environment example is invalid.');
  }
}
