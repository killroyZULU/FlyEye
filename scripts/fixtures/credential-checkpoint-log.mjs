import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const transportMarkers = new Map([
  ['net::ERR_CONNECTION_REFUSED', 'password-transport-connection-refused'],
  ['net::ERR_CONNECTION_RESET', 'password-transport-connection-reset'],
  ['net::ERR_CONNECTION_CLOSED', 'password-transport-connection-closed'],
  ['net::ERR_CONNECTION_TIMED_OUT', 'password-transport-connection-timeout'],
  ['net::ERR_BLOCKED_BY_CLIENT', 'password-transport-blocked-by-client'],
  ['net::ERR_ABORTED', 'password-transport-aborted'],
  ['net::ERR_FAILED', 'password-transport-generic-failure'],
]);
export function passwordTransportMarker(request) {
  try {
    return transportMarkers.get(request.failure()?.errorText) ?? 'password-transport-unknown';
  } catch {
    return 'password-transport-unknown';
  }
}

const stages = new Set([
  ...transportMarkers.values(),
  'password-transport-unknown',
  'browser-preflight',
  'inventory',
  'isolated-startup',
  'pinned-auth-image',
  'baseline-schema',
  'password-sign-in',
  'factor-setup',
  'schema-readiness',
  'storage-setup',
  'approved-control',
  'load-metadata-handler',
  'launch-browser',
  'mount-panel',
  'browser-password',
  'password-check-status',
  'password-ended-with-transport-failure',
  'password-fill-email',
  'password-fill-password',
  'password-click-start',
  'password-click-complete',
  'password-click-failed',
  'password-request-dispatched',
  'password-headers-2xx',
  'password-headers-4xx',
  'password-headers-5xx',
  'password-headers-other',
  'password-transport-failed-before-headers',
  'password-timeout-before-headers',
  'password-timeout-before-dispatch',
  'password-owner-identity',
  'browser-password-passed',
  'browser-totp',
  'browser-totp-passed',
  'first-owner-metadata',
  'metadata-school-owner',
  'first-owner-metadata-passed',
  'wait-my-credentials-heading',
  'read-approved',
  'submit',
  'pending-render',
  'preview',
  'private-image-render',
  'single-pending-version',
  'pending-owner-and-license',
  'approved-record-unchanged',
  'private-preview-audit',
  'persisted-versions-passed',
  'empty-sink',
]);
export function requireStatus(actual, expected) {
  if (actual !== expected) {
    const error = new Error('Unexpected checkpoint response.');
    error.code =
      actual >= 500 ? 'CHECKPOINT_5XX' : actual >= 400 ? 'CHECKPOINT_4XX' : 'CHECKPOINT_STATUS';
    throw error;
  }
}
export function publicLine(line) {
  const marker = /^Checkpoint: ([a-z0-9-]+)$/.exec(line);
  if (marker && stages.has(marker[1])) return line;
  const failure =
    /^Session proof stopped at ([a-z0-9-]+) \((assertion|operation|timeout|http-4xx|http-5xx|unexpected-status)\)\.$/.exec(
      line,
    );
  if (failure && stages.has(failure[1])) return line;
  if (failure && /^migration-\d{14}$/.test(failure[1]))
    return 'Session proof stopped at a fixture migration.';
  if (
    /^Test=(passed|failed|pending) teardown=(passed|failed|not-started) inventory=(match|mismatch|pending|unavailable)$/.test(
      line,
    )
  )
    return line;
  return null;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const safe = publicLine(line);
    if (safe) console.log(safe);
  }
}
