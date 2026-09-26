// Only fixed vocabulary may cross the runtime runner's output boundary.
const commonStages = [
  'identity-creation',
  'database-fixture',
  'authentication',
  'edge-runtime-startup',
  'fixture-cleanup',
  'cleanup-edge-shutdown',
  'cleanup-storage',
  'cleanup-role-restoration',
  'cleanup-domain-rows',
  'cleanup-auth-users',
  'cleanup-assertions',
  'cleanup-temporary-files',
];
const stages = new Map([
  [
    'FEAT-005',
    new Set([
      ...commonStages,
      'privileged-aal1',
      'inactive-role',
      'initial-profile',
      'profile-update',
      'profile-concealment',
      'directory-list',
      'directory-detail',
      'forged-school',
      'aal1-directory',
      'direct-data-denial',
      'suspension',
      'suspended-access',
      'reactivation',
      'revocation',
      'revocation-replay',
      'concurrent-admin-status',
      'audit-privacy',
    ]),
  ],
  [
    'FEAT-007',
    new Set([
      ...commonStages,
      'empty-list',
      'registry-create',
      'registry-replay',
      'duplicate-registration',
      'concurrent-create',
      'registry-search',
      'record-concealment',
      'stale-update',
      'registry-update',
      'concurrent-archive',
      'registry-reactivate',
      'role-boundary',
      'direct-data-audit',
    ]),
  ],
  [
    'FEAT-007B',
    new Set([
      ...commonStages,
      'role-boundary',
      'file-lifecycle',
      'file-initiate',
      'file-upload',
      'file-complete',
      'file-resume',
      'metadata-create',
      'metadata-replay',
      'status-after-create',
      'detail-after-create',
      'concealed-detail-audit',
      'attachment-download',
      'reconciliation-ready',
      'reconciliation-orphan-row',
      'reconciliation-hash-mismatch',
      'reconciliation-missing-object',
      'reconciliation-orphan-object',
      'reconciliation-wrong-scope',
      'reconciliation-unclean-object',
      'renewal-conflict',
      'renewal-success',
      'history-read',
      'notification-read',
      'archived-download',
      'direct-data-audit',
    ]),
  ],
]);
const httpStatuses = new Set([400, 401, 403, 404, 405, 409, 422, 429, 500, 502, 503, 504]);
const failureDetails = new Set([
  'assertion',
  'timeout',
  'transport-failed',
  'response-decoding-failed',
  'unclassified',
  'http-other',
  ...[...httpStatuses].map((status) => `http-${status}`),
]);
const responseDetails = new Set([
  'gateway-502',
  'proxy-name-resolution',
  'audit-failed',
  'service-unavailable',
  'storage-unavailable',
  'scan-failed',
  'scan-unavailable',
  'unknown-server-response',
]);

export function fixtureDiagnostic(feature, stage, event, detail) {
  const validEvent =
    (['enter', 'passed'].includes(event) && detail === undefined) ||
    (event === 'failed' && failureDetails.has(detail)) ||
    (event === 'response' && responseDetails.has(detail)) ||
    (event === 'retry' && ['http-502', 'http-503'].includes(detail));
  if (!stages.get(feature)?.has(stage) || !validEvent) {
    throw new Error('Unsupported fixture diagnostic.');
  }
  return `${feature} runtime diagnostic: stage=${stage} event=${event}${detail === undefined ? '' : ` detail=${detail}`}.`;
}

export function fixtureDiagnosticLines(feature, output) {
  if (typeof output !== 'string') return [];
  return output.split(/\r?\n/).filter((line) => {
    const match =
      /^(FEAT-\d{3}B?) runtime diagnostic: stage=([a-z0-9-]+) event=([a-z]+)(?: detail=([a-z0-9-]+))?\.$/.exec(
        line,
      );
    if (!match || match[1] !== feature) return false;
    try {
      return fixtureDiagnostic(...match.slice(1)) === line;
    } catch {
      return false;
    }
  });
}

function failureDetail(error) {
  if (error?.name === 'AssertionError') {
    if (Number.isInteger(error.actual) && error.actual >= 400 && error.actual <= 599) {
      return httpStatuses.has(error.actual) ? `http-${error.actual}` : 'http-other';
    }
    return 'assertion';
  }
  if (error?.name === 'TimeoutError') return 'timeout';
  if (error?.name === 'SyntaxError') return 'response-decoding-failed';
  return 'unclassified';
}

function responseDetail(feature, response, payload) {
  if (response.status === 502) return 'gateway-502';
  if (response.status === 503 && payload?.message === 'name resolution failed') {
    return 'proxy-name-resolution';
  }
  const namespace = {
    'FEAT-005': 'member_administration',
    'FEAT-007': 'aircraft_registry',
    'FEAT-007B': 'aircraft_documents',
  }[feature];
  for (const code of [
    'audit_failed',
    'service_unavailable',
    'storage_unavailable',
    'scan_failed',
    'scan_unavailable',
  ]) {
    if (payload?.error?.code === `${namespace}.${code}`) return code.replaceAll('_', '-');
  }
  return 'unknown-server-response';
}

export function createFixtureDiagnostics(
  feature,
  {
    enabled = process.env.FLYEYE_RUNTIME_DIAGNOSTICS === '1',
    write = (line) => process.stdout.write(`${line}\n`),
  } = {},
) {
  let currentStage;
  const emit = (stage, event, detail) => {
    const line = fixtureDiagnostic(feature, stage, event, detail);
    if (enabled) write(line);
  };
  const pass = () => {
    if (currentStage) emit(currentStage, 'passed');
    currentStage = undefined;
  };
  return {
    enter(stage) {
      pass();
      currentStage = stage;
      emit(stage, 'enter');
    },
    pass,
    fail(error) {
      if (currentStage) emit(currentStage, 'failed', failureDetail(error));
      currentStage = undefined;
    },
    retry(status) {
      if (currentStage) emit(currentStage, 'retry', `http-${status}`);
    },
    async readResponse(response) {
      let payload;
      try {
        payload = await response.json();
        return { response, payload };
      } finally {
        if (response.status >= 500 && currentStage) {
          emit(currentStage, 'response', responseDetail(feature, response, payload));
        }
      }
    },
    async run(stage, operation) {
      emit(stage, 'enter');
      try {
        const result = await operation();
        emit(stage, 'passed');
        return result;
      } catch (error) {
        emit(stage, 'failed', failureDetail(error));
        throw error;
      }
    },
  };
}
