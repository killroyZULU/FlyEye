import { fixtureDiagnostic } from './fixture-diagnostics.mjs';
import { isLocalStaleTarget } from './local-stale-target.mjs';
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
async function responseDetails(response, forbidden = false) {
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
    if (body.byteLength > 8192)
      return [forbidden ? 'bootstrap-403-other-unreadable' : 'bootstrap-response-oversize'];
    const payload = JSON.parse(body.toString('utf8'));
    if (forbidden) {
      switch (payload?.error?.code) {
        case 'auth.origin_denied':
          return ['bootstrap-403-origin-denied'];
        case 'auth.authentication_method_not_allowed':
          return ['bootstrap-403-authentication-method-not-allowed'];
        default:
          return ['bootstrap-403-other-unreadable'];
      }
    }
    const application = applicationCodes.get(payload?.error?.code);
    if (application) return [application];
    return gatewayResponseDetails(
      { headers: { get: (name) => response.headers()[name] } },
      payload,
    );
  } catch {
    return [forbidden ? 'bootstrap-403-other-unreadable' : 'bootstrap-response-unreadable'];
  } finally {
    clearTimeout(timer);
  }
}

export async function reportBootstrapFailure({
  response,
  forbiddenResponse,
  since,
  projectId,
  report,
  traceDetail,
  localStaleTarget,
  ci = process.env.CI,
  githubActions = process.env.GITHUB_ACTIONS,
  collect = collectGatewayDiagnostics,
}) {
  const inCi = ci === 'true' && githubActions === 'true';
  if (!inCi && !isLocalStaleTarget(localStaleTarget, projectId)) return;
  const emit = (stage, detail) => {
    try {
      fixtureDiagnostic('FEAT-003', stage, 'response', detail);
      report(stage, 'response', detail);
    } catch {
      // Never replace the original failure or prevent cleanup.
    }
  };
  if (traceDetail !== undefined || !inCi)
    emit('bootstrap-trace', traceDetail ?? 'bootstrap-trace-unknown');
  // Local approval covers only the private fixture trace, not provider-log collection.
  if (!inCi) return;
  if (forbiddenResponse)
    for (const detail of await responseDetails(forbiddenResponse, true))
      emit('bootstrap-response', detail);
  if (response || !forbiddenResponse)
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
