import assert from 'node:assert/strict';

const operationId = '40000000-0000-4000-8000-000000000002';
const factorId = '50000000-0000-4000-8000-000000000001';
const base = {
  organizationId: '20000000-0000-4000-8000-000000000001',
  organizationName: 'Synthetic Flight School',
  membershipId: '10000000-0000-4000-8000-000000000001',
  correlationId: '30000000-0000-4000-8000-000000000001',
};
const reply = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockVerification(page, state) {
  await page.route('**/functions/v1/member-mfa', (route) => {
    const body = route.request().postDataJSON();
    state.requests.push(body);
    if (body.action === 'status')
      return reply(route, {
        ...base,
        decision: 'available',
        ready: false,
        operationState: 'bound',
        operationId,
        operationVersion: 2,
        factorState: 'resume_required',
      });
    if (body.action === 'complete') {
      if (state.requests.filter((request) => request.action === 'complete').length === 1)
        return reply(route, { error: { code: 'member_mfa.unavailable' } }, 503);
      return reply(route, {
        decision: 'completed',
        organizationId: base.organizationId,
        membershipId: base.membershipId,
        correlationId: base.correlationId,
        readinessVersion: 1,
        replayed: false,
      });
    }
    assert.equal(body.action, 'cancel');
    return reply(route, {});
  });
  await page.route('**/auth/v1/user*', (route) =>
    reply(route, {
      ...state.session.user,
      factors: [{ id: factorId, factor_type: 'totp', status: 'unverified' }],
    }),
  );
  await page.route('**/auth/v1/factors/*/challenge', (route) => {
    state.challenges++;
    if (state.failure === 'challenge-rate-limit')
      return reply(route, { error_code: 'over_request_rate_limit', msg: 'Synthetic limit' }, 429);
    return reply(route, { id: operationId, expires_at: Math.floor(Date.now() / 1000) + 60 });
  });
  await page.route('**/auth/v1/factors/*/verify', (route) => {
    if (state.failure === 'verify-unavailable')
      return reply(route, { error_code: 'unexpected_failure', msg: 'Synthetic unavailable' }, 503);
    if (state.failure === 'assurance-unconfirmed') return reply(route, state.session);
    const parts = state.session.access_token.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    parts[1] = Buffer.from(JSON.stringify({ ...claims, aal: 'aal2' })).toString('base64url');
    return reply(route, { ...state.session, access_token: parts.join('.') });
  });
}

export async function checkMemberMfaVerification(browser, mockSupabase, submitLogin) {
  for (const required of [false, true]) {
    for (const failure of ['challenge-rate-limit', 'verify-unavailable', 'assurance-unconfirmed']) {
      const page = await browser.newPage({
        viewport: required ? { width: 393, height: 851 } : { width: 1280, height: 800 },
      });
      try {
        const state = { failure, requests: [], challenges: 0 };
        await page.route('http://127.0.0.1:55321/**', (route) => route.abort());
        await mockSupabase(page, { privilegedMissingMfa: required });
        await mockVerification(page, state);
        const enter = async () => {
          const response = page.waitForResponse('**/auth/v1/token?grant_type=password');
          await submitLogin(page);
          state.session = await (await response).json();
          if (!required)
            await page.getByRole('button', { name: 'Account security', exact: true }).click();
          await page.getByRole('button', { name: 'Resume secure setup' }).click();
          await page.getByLabel('Verification code').fill('123456');
          await page.getByRole('button', { name: 'Verify authenticator' }).click();
        };
        await page.goto('http://127.0.0.1:4173');
        await enter();
        const blocked = page.getByRole('heading', { name: 'Authenticator setup is blocked' });
        await blocked.waitFor();
        assert.equal(
          await blocked.evaluate((element) => element === globalThis.document.activeElement),
          true,
        );
        assert.match(await page.getByRole('alert').innerText(), /Wait|could not be confirmed/i);
        assert.equal(await page.getByText(/Your authenticator code was verified/).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Retry confirmation' }).count(), 0);
        assert.equal(await page.getByLabel('Verification code').count(), 0);
        assert.equal(state.requests.filter((request) => request.action === 'complete').length, 0);
        assert.equal(state.challenges, 1);
        await page.keyboard.press('Tab');
        const cancel = page.getByRole('button', { name: 'Cancel and sign out' });
        assert.equal(
          await cancel.evaluate((element) => element === globalThis.document.activeElement),
          true,
        );
        await page.keyboard.press('Enter');
        await page.getByRole('heading', { name: 'Sign in to FlyEye' }).waitFor();
        const cancellation = state.requests.find((request) => request.action === 'cancel');
        assert.equal(cancellation.operationId, operationId);
        assert.equal(cancellation.expectedVersion, 2);
        assert.equal(cancellation.factorId, factorId);
        state.failure = undefined;
        await enter();
        await page.getByRole('button', { name: 'Retry confirmation' }).waitFor();
        assert.equal(await page.getByText(/Your authenticator code was verified/).count(), 1);
        await page.getByRole('button', { name: 'Retry confirmation' }).click();
        await page.getByRole('heading', { name: 'Authenticator is ready' }).waitFor();
        const completions = state.requests.filter((request) => request.action === 'complete');
        assert.equal(completions.length, 2);
        assert.deepEqual(completions[0], completions[1]);
        assert.equal(completions[0].operationId, operationId);
        assert.equal(completions[0].expectedVersion, 2);
        assert.equal(state.challenges, 2);
        assert.equal(
          state.requests.some((request) => request.action === 'start'),
          false,
        );
      } finally {
        await page.close();
      }
    }
  }
  process.stdout.write('PASS member MFA verification failures and bounded recovery (six cases).\n');
}
