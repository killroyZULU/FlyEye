import { fixtureDiagnostic } from './fixture-diagnostics.mjs';
import {
  collectGatewayDiagnostics,
  gatewayResponseDetails,
} from './onboarding-gateway-diagnostics.mjs';

const applicationCodes = new Map([
  ['auth.limiter_unavailable', 'bootstrap-limiter-unavailable'],
  ['auth.factor_inventory_unavailable', 'bootstrap-factor-inventory-unavailable'],
  ['auth.audit_unavailable', 'bootstrap-audit-unavailable'],
  ['auth.access_context_unavailable', 'bootstrap-access-context-unavailable'],
]);

// These describe received headers, not which component generated the response.
function headerDetails(response) {
  try {
    const headers = response.headers();
    const server = /^kong\/[0-9.]+$/.test(headers.server ?? '')
      ? 'kong-response'
      : 'bootstrap-server-unknown';
    const type = headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
    const content =
      type === 'application/json'
        ? 'bootstrap-content-json'
        : type === 'text/html'
          ? 'bootstrap-content-html'
          : type
            ? 'bootstrap-content-other'
            : 'bootstrap-content-missing';
    return [server, content];
  } catch {
    return ['bootstrap-headers-unavailable'];
  }
}

// Read only an already received error response. No new request or retry.
async function bodyDetails(response) {
  let timer;
  const expired = Symbol('diagnostic read expired');
  try {
    const body = await Promise.race([
      response.body(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(expired), 1000);
      }),
    ]);
    if (body === expired) return ['bootstrap-body-read-expired'];
    // Playwright returns a complete buffer; bound parsing, not browser buffering.
    if (body.byteLength > 8192) return ['bootstrap-response-oversize'];
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      return ['bootstrap-body-invalid-json'];
    }
    const application = applicationCodes.get(payload?.error?.code);
    if (application) return [application];
    return gatewayResponseDetails({ headers: { get: () => undefined } }, payload);
  } catch {
    return ['bootstrap-body-read-rejected'];
  } finally {
    clearTimeout(timer);
  }
}

async function responseDetails(response) {
  if (!response) return ['bootstrap-response-missing'];
  const headers = headerDetails(response);
  return [...(await bodyDetails(response)), ...headers];
}

export async function reportBootstrapFailure({
  response,
  since,
  projectId,
  report,
  ci = process.env.CI,
  githubActions = process.env.GITHUB_ACTIONS,
  collect = collectGatewayDiagnostics,
  cliDetails = ['diagnostic-unavailable'],
}) {
  if (ci !== 'true' || githubActions !== 'true') return;
  const emit = (stage, detail) => {
    try {
      fixtureDiagnostic('FEAT-003', stage, 'response', detail);
      report(stage, 'response', detail);
    } catch {
      // Never replace the original failure or prevent cleanup.
    }
  };
  for (const detail of await responseDetails(response)) emit('bootstrap-response', detail);
  for (const detail of cliDetails) emit('bootstrap-cli-log', detail);
  let evidence;
  try {
    evidence = collect({ projectId, since, ci, githubActions });
  } catch {
    evidence = [];
  }
  for (const stage of ['gateway-log', 'worker-log']) {
    const entry = evidence.find((value) => value.stage === stage);
    for (const detail of entry?.details ?? ['diagnostic-unavailable']) emit(stage, detail);
  }
}
