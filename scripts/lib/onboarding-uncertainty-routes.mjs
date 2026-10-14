import assert from 'node:assert/strict';

export const uncertaintyBrowserCases = [
  'lookup',
  'enroll',
  'enroll-lost',
  'challenge',
  'verify',
  'verify-lost',
  'assurance',
  'bootstrap',
];

export async function uncertaintyRoutes(page, { name, apiUrl, snapshot, inspectVerification }) {
  const state = {
    commands: [],
    requests: [],
    hits: 0,
    upstreamFaults: 0,
    armed: true,
    failed: false,
  };
  let passwordToken;
  const apiOrigin = new URL(apiUrl).origin;
  await page.route(`${apiOrigin}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method === 'OPTIONS') return route.continue();
    try {
      const isCommand = method === 'POST' && path.startsWith('/functions/v1/');
      const input = isCommand ? request.postDataJSON() : undefined;
      const endpoint = path.split('/').at(-1);
      const started = state.commands.some((entry) => entry.input.action === 'start');
      const completed = state.commands.some((entry) => entry.input.action === 'complete');
      const selected =
        state.armed &&
        ((name === 'lookup' && started && path === '/auth/v1/user' && method === 'GET') ||
          (name.startsWith('enroll') && path === '/auth/v1/factors' && method === 'POST') ||
          (name === 'challenge' && path.endsWith('/challenge') && method === 'POST') ||
          (['verify', 'verify-lost', 'assurance'].includes(name) &&
            path.endsWith('/verify') &&
            method === 'POST') ||
          (name === 'bootstrap' &&
            completed &&
            endpoint === 'auth-bootstrap' &&
            method === 'POST'));
      state.requests.push({ path, method, selected });
      const before = isCommand ? snapshot() : undefined;
      if (selected) {
        state.hits++;
        if (name.endsWith('-lost') || name === 'assurance') {
          const response = await route.fetch({ maxRetries: 0, timeout: 15_000 });
          assert.equal(response.status(), 200);
          state.upstreamFaults++;
          const data = await response.json();
          if (name === 'verify-lost' || name === 'assurance')
            inspectVerification(passwordToken, data.access_token);
          if (name === 'assurance') {
            // Real provider verification committed; deliver the earlier real AAL1 token
            // to model uncertain session delivery, not a provider downgrade.
            assert.ok(passwordToken);
            await route.fulfill({ response, json: { ...data, access_token: passwordToken } });
            return;
          }
        }
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ msg: 'Synthetic provider unavailable' }),
        });
        return;
      }
      if (isCommand || (path === '/auth/v1/token' && method === 'POST')) {
        const response = await route.fetch({ maxRetries: 0, timeout: 15_000 });
        const result = { status: response.status(), payload: await response.json() };
        if (path === '/auth/v1/token' && request.postDataJSON().grant_type !== 'refresh_token') {
          if (new URL(request.url()).searchParams.get('grant_type') === 'password')
            passwordToken = result.payload.access_token;
        }
        if (isCommand)
          state.commands.push({
            endpoint,
            input,
            before,
            after: snapshot(),
            result,
            token: request.headers().authorization?.slice(7),
          });
        await route.fulfill({ response });
      } else await route.continue();
    } catch {
      state.failed = true;
      await route.abort().catch(() => {});
    }
  });
  return state;
}
