const stages = [
  'stale-network-password',
  'stale-network-bootstrap',
  'stale-network-status',
  'stale-network-start',
];
const statuses = new Set([400, 401, 403, 404, 405, 409, 422, 429, 500, 502, 503, 504]);

function requestStage(request, apiOrigin) {
  try {
    if (request.method() !== 'POST') return undefined;
    const url = new URL(request.url());
    if (url.origin !== apiOrigin) return undefined;
    if (
      url.pathname === '/auth/v1/token' &&
      url.searchParams.getAll('grant_type').length === 1 &&
      url.searchParams.get('grant_type') === 'password'
    )
      return stages[0];
    if (url.pathname === '/functions/v1/auth-bootstrap') return stages[1];
    if (url.pathname === '/functions/v1/organization-admin-onboarding') {
      // Inspect only the action selector; never retain or emit the request body.
      const action = request.postDataJSON()?.action;
      return action === 'status' ? stages[2] : action === 'start' ? stages[3] : undefined;
    }
  } catch {
    /* A diagnostic observer must not interfere with the request. */
  }
  return undefined;
}
const responseCategory = (status) =>
  Number.isInteger(status) && status >= 200 && status < 300
    ? 'http-2xx'
    : statuses.has(status)
      ? `http-${status}`
      : 'http-other';

// Passive page listeners only: no request, route, wait, response-body read or retry.
export function observeOnboardingLogin(page, report, apiUrl) {
  const apiOrigin = new URL(apiUrl).origin;
  let active = false;
  let requests = new WeakMap();
  let observations;
  function request(request) {
    if (!active) return;
    const stage = requestStage(request, apiOrigin);
    if (!stage) return;
    requests.set(request, stage);
    observations.get(stage).pending++;
    observations.get(stage).seen = true;
  }
  function settled(request, outcome) {
    if (!active) return;
    const stage = requests.get(request);
    if (!stage) return;
    requests.delete(request);
    observations.get(stage).pending--;
    observations.get(stage).outcomes.add(outcome);
  }
  const response = (value) => {
    if (!active) return;
    const stage = requests.get(value.request());
    if (stage) observations.get(stage).outcomes.add(responseCategory(value.status()));
  };
  const failed = (request) => settled(request, 'transport-failed');
  const finished = (request) => settled(request, 'request-finished');
  page.on('request', request);
  page.on('response', response);
  page.on('requestfailed', failed);
  page.on('requestfinished', finished);
  return {
    begin() {
      requests = new WeakMap();
      observations = new Map(
        stages.map((stage) => [stage, { seen: false, pending: 0, outcomes: new Set() }]),
      );
      active = true;
    },
    finish() {
      if (!active) return;
      active = false;
      requests = new WeakMap();
      for (const [stage, value] of observations) {
        if (!value.seen) value.outcomes.add('request-not-observed');
        if (value.pending) value.outcomes.add('request-pending');
        for (const outcome of [...value.outcomes].sort()) {
          try {
            report(stage, 'response', outcome);
          } catch {
            // Diagnostics must not replace the original browser failure or skip other categories.
          }
        }
      }
      observations = undefined;
    },
    dispose() {
      active = false;
      observations = undefined;
      requests = new WeakMap();
      page.off('request', request);
      page.off('response', response);
      page.off('requestfailed', failed);
      page.off('requestfinished', finished);
    },
  };
}
