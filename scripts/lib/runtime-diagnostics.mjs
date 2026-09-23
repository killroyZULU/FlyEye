const feat006Stages = new Set([
  'fixture-setup',
  'edge-startup',
  'password-sign-in',
  'readiness-status',
  'enrollment-start',
  'totp-enroll',
  'factor-inventory',
  'factor-bind',
  'totp-verify',
  'readiness-complete',
  'persistence-assertions',
  'fixture-cleanup',
  'cleanup-edge-shutdown',
  'cleanup-auth-refresh',
  'cleanup-limiter-rows',
  'cleanup-domain-rows',
  'cleanup-auth-user',
  'cleanup-identity-assertions',
  'cleanup-key-assertions',
  'cleanup-discarded-event',
  'cleanup-baseline-assertions',
  'cleanup-temporary-files',
]);
const events = new Set(['enter', 'passed', 'failed']);
const feat007bStages = new Set([
  'identity-creation',
  'database-fixture',
  'authentication',
  'edge-runtime-startup',
  'role-boundary',
  'file-lifecycle',
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
]);
const failureDetails = new Set([
  'assertion',
  'transport-failed',
  'response-decoding-failed',
  'unclassified',
  'http-400',
  'http-401',
  'http-403',
  'http-409',
  'http-422',
  'http-429',
  'http-500',
  'http-502',
  'http-503',
  'http-504',
  'http-other',
]);
const feat003Pattern = /^FEAT-003 runtime diagnostic: stage=[a-z0-9-]+ event=(?:enter|passed)\.$/;
const feat006Pattern =
  /^FEAT-006 runtime diagnostic: stage=([a-z0-9-]+) event=([a-z]+)(?: detail=([a-z0-9-]+))?\.$/;
const feat007bPattern =
  /^FEAT-007B runtime diagnostic: stage=([a-z0-9-]+) event=(enter|passed|failed)(?: detail=([a-z0-9-]+))?\.$/;
const feat007bFailureDetails = new Set([
  'assertion',
  'timeout',
  'http-400',
  'http-401',
  'http-403',
  'http-404',
  'http-409',
  'http-429',
  'http-500',
  'http-502',
  'http-503',
  'http-504',
  'http-other',
  'unclassified',
]);

function validOutcome(event, detail) {
  if (event === 'retry') return detail === 'http-502' || detail === 'http-503';
  return (
    events.has(event) &&
    (detail === undefined || (event === 'failed' && failureDetails.has(detail)))
  );
}

export function feat006Diagnostic(stage, event, detail) {
  if (!feat006Stages.has(stage) || !validOutcome(event, detail)) {
    throw new Error('Unsupported FEAT-006 runtime diagnostic.');
  }
  return `FEAT-006 runtime diagnostic: stage=${stage} event=${event}${detail === undefined ? '' : ` detail=${detail}`}.`;
}

export function runtimeDiagnosticLines(fixture, output) {
  if (typeof output !== 'string') return [];
  return output.split(/\r?\n/).filter((line) => {
    if (fixture === 'test-feat-003-runtime.mjs') return feat003Pattern.test(line);
    if (fixture === 'test-feat-007b-runtime.mjs') {
      const match = feat007bPattern.exec(line);
      return (
        match !== null &&
        feat007bStages.has(match[1]) &&
        (match[2] === 'failed' ? feat007bFailureDetails.has(match[3]) : match[3] === undefined)
      );
    }
    if (fixture !== 'test-feat-006-runtime.mjs') return false;
    const match = feat006Pattern.exec(line);
    return match !== null && feat006Stages.has(match[1]) && validOutcome(match[2], match[3]);
  });
}
