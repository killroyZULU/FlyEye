import assert from 'node:assert/strict';

export async function waitForOnboardingWorker({
  url,
  origin,
  apiKey,
  token,
  fetchRequest,
  isAlive,
  reportFailure = () => {},
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let lastFailure = 'readiness-no-response';
  const fail = (message) => {
    try {
      reportFailure(lastFailure);
    } catch {
      /* Preserve the readiness failure. */
    }
    throw new Error(message);
  };
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!isAlive()) return fail('Local Edge Runtime stopped before readiness.');
    try {
      lastFailure = 'readiness-transport-error';
      // GET is rejected before provider authentication, rate limiting or database work.
      const response = await fetchRequest(
        url,
        {
          method: 'GET',
          headers: { apikey: apiKey, authorization: `Bearer ${token}`, origin },
        },
        2_000,
      );
      lastFailure = 'readiness-unreadable-response';
      const payload = await response.json();
      lastFailure =
        response.status === 401
          ? 'readiness-auth-rejected'
          : response.status >= 500
            ? 'readiness-server-error'
            : response.status === 403 && payload?.error?.code === 'admin_onboarding.origin_denied'
              ? 'readiness-old-origin'
              : 'readiness-contract-mismatch';
      const corsOrigin = response.headers.get('access-control-allow-origin');
      if (response.status === 405) {
        assert.deepEqual(payload, {
          error: {
            code: 'admin_onboarding.method_not_allowed',
            message: 'This request is not supported.',
          },
        });
        // The pinned Kong CORS plugin replaces the upstream header with '*'.
        // The handler checks our unique Origin before producing this exact 405 body.
        if (corsOrigin === origin || corsOrigin === '*') return;
        lastFailure = 'readiness-cors-mismatch';
      }
    } catch {
      // Retry only this inert readiness probe, never an onboarding action.
    }
    if (attempt < 79) await delay(250);
  }
  return fail('Local Edge Runtime did not become ready.');
}
