import assert from 'node:assert/strict';

export async function waitForOnboardingWorker({
  url,
  origin,
  apiKey,
  token,
  fetchRequest,
  isAlive,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!isAlive()) throw new Error('Local Edge Runtime stopped before readiness.');
    try {
      // GET is rejected before provider authentication, rate limiting or database work.
      const response = await fetchRequest(
        url,
        {
          method: 'GET',
          headers: { apikey: apiKey, authorization: `Bearer ${token}`, origin },
        },
        2_000,
      );
      const payload = await response.json();
      if (
        response.status === 405 &&
        response.headers.get('access-control-allow-origin') === origin
      ) {
        assert.deepEqual(payload, {
          error: {
            code: 'admin_onboarding.method_not_allowed',
            message: 'This request is not supported.',
          },
        });
        return;
      }
    } catch {
      // Retry only this inert readiness probe, never an onboarding action.
    }
    if (attempt < 79) await delay(250);
  }
  throw new Error('Local Edge Runtime did not become ready.');
}
