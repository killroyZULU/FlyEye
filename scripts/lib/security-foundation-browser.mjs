/* global document, getComputedStyle -- Browser-evaluated checks. */
import assert from 'node:assert/strict';

async function layout(page) {
  const result = await page.locator('.security-foundation').evaluate((root) => {
    const luminance = (color) =>
      color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (a, b) =>
      (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    const background = (e) => {
      while (getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)' && e.parentElement)
        e = e.parentElement;
      return getComputedStyle(e).backgroundColor;
    };
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      text: [...root.querySelectorAll('h2, p, span, label, input, button, .form-error')]
        .filter((e) => e.getClientRects().length)
        .every((e) => contrast(getComputedStyle(e).color, background(e)) >= 4.5),
      controls: [...root.querySelectorAll('input, button')].every((e) => {
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        return (
          r.width >= 44 &&
          r.height >= 44 &&
          r.left >= 0 &&
          r.right <= document.documentElement.clientWidth + 1 &&
          contrast(s.borderTopColor, background(e.parentElement)) >= 3 &&
          (!e.matches(':focus-visible') ||
            (s.outlineWidth === '2px' &&
              contrast(s.outlineColor, background(e.parentElement)) >= 3))
        );
      }),
    };
  });
  assert.deepEqual(
    result,
    { overflow: false, text: true, controls: true },
    'Security layout, contrast and targets',
  );
}

const base = {
  organizationId: '20000000-0000-4000-8000-000000000001',
  organizationName:
    'Synthetic Flight School for Professional Aviation Training and Instruction — Long Name Verification',
  membershipId: '10000000-0000-4000-8000-000000000001',
  correlationId: '30000000-0000-4000-8000-000000000001',
};
const operationId = '40000000-0000-4000-8000-000000000002';
const factorId = '50000000-0000-4000-8000-000000000001';
const reply = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockSecurity(page, state) {
  await page.route('**/functions/v1/member-mfa', async (route) => {
    const body = route.request().postDataJSON();
    state.requests.push(body);
    if (body.action === 'status') {
      if (state.loading) await state.loading;
      if (state.error) return reply(route, { error: { code: state.error } }, 409);
      return reply(route, {
        ...base,
        decision: 'available',
        ready: state.mode === 'ready',
        factorState:
          state.mode === 'bound'
            ? 'resume_required'
            : state.mode === 'started'
              ? 'cancellation_required'
              : 'enrollment_required',
        ...(['bound', 'started'].includes(state.mode)
          ? { operationState: state.mode, operationId, operationVersion: 2 }
          : {}),
      });
    }
    if (body.action === 'start')
      return reply(route, {
        ...base,
        decision: 'ready',
        operationId,
        operationVersion: 1,
        replayed: false,
        factorState: 'enrollment_required',
      });
    if (body.action === 'bind_factor')
      return reply(route, {
        decision: 'bound',
        operationId,
        operationVersion: 2,
        replayed: false,
        correlationId: base.correlationId,
      });
    if (body.action === 'complete') {
      if (state.completing) await state.completing;
      if (state.failCompletion)
        return reply(route, { error: { code: 'member_mfa.unavailable' } }, 503);
      return reply(route, {
        decision: 'completed',
        organizationId: base.organizationId,
        membershipId: base.membershipId,
        readinessVersion: 1,
        replayed: false,
        correlationId: base.correlationId,
      });
    }
    assert.equal(body.action, 'cancel');
    return reply(route, {});
  });
  await page.route('**/auth/v1/user*', (route) =>
    reply(route, {
      ...state.session.user,
      factors:
        state.mode === 'bound' || state.enrolled
          ? [{ id: factorId, factor_type: 'totp', status: 'unverified' }]
          : [],
    }),
  );
  await page.route('**/auth/v1/factors', (route) => {
    state.enrolled = true;
    return reply(route, {
      id: factorId,
      type: 'totp',
      totp: {
        qr_code:
          '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect x="0" y="0" width="240" height="240" style="fill:white"/></svg>',
        secret: 'A'.repeat(32),
        uri: 'otpauth://totp/synthetic-placeholder',
      },
    });
  });
  await page.route('**/auth/v1/factors/*/challenge', (route) =>
    reply(route, { id: operationId, expires_at: Math.floor(Date.now() / 1000) + 60 }),
  );
  await page.route('**/auth/v1/factors/*/verify', async (route) => {
    state.verifyCount = (state.verifyCount ?? 0) + 1;
    if (state.verifying) await state.verifying;
    if (state.invalid)
      return reply(route, { error_code: 'mfa_verification_failed', msg: 'Invalid code' }, 422);
    const parts = state.session.access_token.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    parts[1] = Buffer.from(JSON.stringify({ ...claims, aal: 'aal2' })).toString('base64url');
    return reply(route, { ...state.session, access_token: parts.join('.') });
  });
}

export async function checkSecurityFoundation(browser, mockSupabase, submitLogin) {
  const open = async (page, state) => {
    state.requests = [];
    await page.route('http://127.0.0.1:55321/**', (route) => route.abort());
    await mockSupabase(page);
    await mockSecurity(page, state);
    await page.goto('http://127.0.0.1:4173');
    const response = page.waitForResponse('**/auth/v1/token?grant_type=password');
    await submitLogin(page);
    state.session = await (await response).json();
    await page
      .getByRole('navigation')
      .getByRole('button', { name: 'Account security', exact: true })
      .click();
    await page.locator('.security-foundation').waitFor();
    await page.evaluate(() => document.fonts.ready);
  };
  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      const state = { mode: 'new' };
      await open(page, state);
      await page.getByRole('button', { name: 'Begin secure setup' }).click();
      await page.getByLabel('Verification code').waitFor();
      await layout(page);
      const toggle = page.getByRole('button', { name: 'Show manual setup key' });
      await toggle.focus();
      await page.keyboard.press('Enter');
      assert.equal(
        await page
          .getByRole('button', { name: 'Hide manual setup key' })
          .getAttribute('aria-expanded'),
        'true',
      );
      await layout(page);
      await page.keyboard.press('Tab');
      assert.equal(
        await page.getByLabel('Verification code').evaluate((e) => e === document.activeElement),
        true,
      );
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await page.getByRole('alert').waitFor();
      await page.waitForFunction(() => document.activeElement?.id === 'member-totp-code');
      await layout(page);
      const cdp = await page.context().newCDPSession(page);
      const tree = await cdp.send('Accessibility.getFullAXTree');
      assert.ok(
        tree.nodes.some(
          (n) => !n.ignored && n.role.value === 'textbox' && n.name?.value === 'Verification code',
        ),
      );
      await page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true }).click();
      assert.equal(await page.locator('.security-foundation').count(), 0);
    } finally {
      await page.close();
    }
  }
  for (const mode of ['ready', 'started', 'bound', 'error']) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 400 },
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    let release = () => {};
    try {
      await page.route('**/fonts/*.woff2', (route) => route.abort());
      const state = {
        mode,
        error: mode === 'error' ? 'member_mfa.factor_conflict' : undefined,
        loading: new Promise((r) => {
          release = r;
        }),
      };
      await open(page, state);
      await page.getByRole('heading', { name: 'Checking authenticator state' }).waitFor();
      assert.equal(
        await page
          .locator('.loading-line')
          .evaluate((e) => getComputedStyle(e, '::after').animationName),
        'none',
      );
      await layout(page);
      release();
      const action = {
        ready: 'Return to workspace',
        started: 'Cancel incomplete setup',
        bound: 'Resume secure setup',
        error: 'Close',
      }[mode];
      await page.getByRole('button', { name: action, exact: true }).waitFor();
      for (const viewport of [
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
        { width: 390, height: 400 },
      ]) {
        await page.setViewportSize(viewport);
        await layout(page);
      }
      await page.getByRole('button', { name: action, exact: true }).tap();
      if (mode === 'bound') {
        await page.getByLabel('Verification code').waitFor();
        assert.equal(await page.locator('.admin-enrollment-qr, .manual-secret').count(), 0);
        await layout(page);
        await page.getByRole('button', { name: 'Cancel and sign out' }).tap();
        await page.getByLabel('Password', { exact: true }).waitFor();
      } else if (mode === 'started') await page.getByLabel('Password', { exact: true }).waitFor();
      assert.equal(await page.locator('.security-foundation').count(), 0);
    } finally {
      release();
      await page.close();
    }
  }

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let releaseVerify = () => {},
    releaseComplete = () => {};
  try {
    const state = { mode: 'new', invalid: true, failCompletion: true };
    await open(page, state);
    await page.getByRole('button', { name: 'Begin secure setup' }).click();
    const code = page.getByLabel('Verification code');
    await code.fill('123456');
    await page.getByRole('button', { name: 'Verify authenticator', exact: true }).click();
    await page.getByText('The verification code is invalid or expired.').waitFor();
    assert.ok((await code.inputValue()).length === 6, 'Invalid input retained');
    assert.equal(await page.locator('.admin-enrollment-qr').count(), 1);
    await layout(page);
    state.invalid = false;
    state.verifying = new Promise((r) => {
      releaseVerify = r;
    });
    state.completing = new Promise((r) => {
      releaseComplete = r;
    });
    await page.getByRole('button', { name: 'Verify authenticator', exact: true }).click();
    const pending = page.getByRole('button', { name: 'Verifying code' });
    await pending.waitFor();
    assert.equal(await code.isDisabled(), true);
    assert.equal(await pending.isDisabled(), true);
    await pending.evaluate((e) => {
      e.click();
      e.click();
    });
    await layout(page);
    releaseVerify();
    await page.getByRole('heading', { name: 'Confirm authenticator readiness' }).waitFor();
    assert.equal(
      await page.locator('.admin-enrollment-qr, .manual-secret, #member-totp-code').count(),
      0,
    );
    await layout(page);
    releaseComplete();
    await page.getByRole('button', { name: 'Retry confirmation' }).waitFor();
    assert.equal(state.verifyCount, 2, 'Pending activation sends no duplicate verification');
    await layout(page);
    state.failCompletion = false;
    await page.getByRole('button', { name: 'Retry confirmation' }).click();
    await page.getByRole('heading', { name: 'Authenticator is ready' }).waitFor();
    const completions = state.requests.filter((r) => r.action === 'complete');
    assert.equal(completions.length, 2);
    assert.deepEqual(
      completions[0],
      completions[1],
      'Retry keeps operation, version and idempotency key',
    );
    await layout(page);
  } finally {
    releaseVerify();
    releaseComplete();
    await page.close();
  }
  const legacy = await browser.newPage();
  try {
    await mockSupabase(legacy, { privilegedMissingMfa: true });
    await legacy.goto('http://127.0.0.1:4173');
    await submitLogin(legacy);
    await legacy.getByRole('button', { name: 'Begin secure setup' }).waitFor();
    assert.equal(await legacy.locator('.security-foundation').count(), 0);
    assert.equal(
      await legacy
        .locator('.state-panel h2')
        .evaluate((e) => getComputedStyle(e).fontFamily.includes('Archivo')),
      false,
    );
  } finally {
    await legacy.close();
  }
  process.stdout.write(
    'PASS security foundation: six widths, enrollment/manual toggle, keyboard/validation, contrast/targets, loading/ready/interrupted/error, touch/orientation/reduced-height, reduced motion/font fallback, invalid input preservation, pending command suppression, credential clearing, bounded retry, cancellation and mandatory-sign-in style isolation.\n',
  );
}
