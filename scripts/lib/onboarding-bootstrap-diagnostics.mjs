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

// Read only an already received error response. No new request or retry.
async function responseDetails(response) {
  if (!response) return ['bootstrap-response-missing'];
  let timer;
  try {
    const body = await Promise.race([
      response.body(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Diagnostic read expired.')), 1000);
      }),
    ]);
    // Playwright returns a complete buffer; bound parsing, not browser buffering.
    if (body.byteLength > 8192) return ['bootstrap-response-oversize'];
    const payload = JSON.parse(body.toString('utf8'));
    const application = applicationCodes.get(payload?.error?.code);
    if (application) return [application];
    return gatewayResponseDetails(
      { headers: { get: (name) => response.headers()[name] } },
      payload,
    );
  } catch {
    return ['bootstrap-response-unreadable'];
  } finally {
    clearTimeout(timer);
  }
}

export async function reportBootstrapFailure({
  response,
  since,
  projectId,
  report,
  ci = process.env.CI,
  githubActions = process.env.GITHUB_ACTIONS,
  collect = collectGatewayDiagnostics,
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
