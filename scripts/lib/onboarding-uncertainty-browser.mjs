import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { memberMfaBrowser } from './member-mfa-browser.mjs';
import { issueGrant } from './onboarding-provider-cases.mjs';
import { uncertaintyBrowserCases, uncertaintyRoutes } from './onboarding-uncertainty-routes.mjs';
import {
  assertUnchangedAuthority,
  assertVerifiedDelivery,
} from './onboarding-uncertainty-evidence.mjs';
import {
  assertProviderCompletion,
  providerAuthenticationMethods,
} from './onboarding-provider-evidence.mjs';

export function onboardingUncertaintyBrowser() {
  const frontend = memberMfaBrowser();
  let browser;
  return {
    start: (url, key) => frontend.start(url, key),
    closeFrontend: () => frontend.closeFrontend(),
    async closeBrowser() {
      await browser?.close();
      if (browser) assert.equal(browser.isConnected(), false);
    },
    async run(context) {
      assert.equal(context.users.length, uncertaintyBrowserCases.length);
      browser = await chromium.launch({ headless: true });
      for (const [index, name] of uncertaintyBrowserCases.entries()) {
        if (context.cleanupProbe && name !== 'verify-lost') continue;
        await runCase(browser, context, context.users[index], name);
      }
    },
  };
}

async function runCase(browser, context, user, name) {
  const {
    organizationId,
    sourceInstanceId,
    psql,
    signIn,
    evidence,
    origin,
    apiUrl,
    password,
    currentTotp,
    clearScenario,
    cleanupProbe,
    enterStage,
    reportDiagnostic,
  } = context;
  const stage = `uncertainty-browser-${name}`;
  enterStage(stage, stage);
  const grantId = randomUUID();
  const snapshot = () => evidence.snapshot(user.id, grantId);
  issueGrant(psql, organizationId, user.id, grantId, sourceInstanceId);
  const enrollment = name.startsWith('enroll');
  let secret;
  let usedCode;
  if (!enrollment) {
    const actor = await signIn(user);
    const enrolled = await actor.client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Synthetic uncertainty',
    });
    assert.equal(Boolean(enrolled.error), false);
    secret = enrolled.data.totp.secret;
    usedCode = currentTotp(secret);
    const verified = await actor.client.auth.mfa.challengeAndVerify({
      factorId: enrolled.data.id,
      code: usedCode,
    });
    assert.equal(Boolean(verified.error), false);
    evidence.captureParents();
  }
  const inventory = () =>
    evidence.json(
      `select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from (select id,status,factor_type from auth.mfa_factors where user_id='${user.id}') t;`,
    );
  const originalFactors = inventory();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(15_000);
  let leaked = false;
  let passed = false;
  page.on('console', (message) => {
    if (message.text().includes('otpauth://') || (secret && message.text().includes(secret)))
      leaked = true;
  });
  const state = await uncertaintyRoutes(page, {
    name,
    apiUrl,
    snapshot,
    inspectVerification: (passwordToken, verifiedToken) =>
      assertVerifiedDelivery(passwordToken, verifiedToken, user.id, (sessionId) =>
        evidence.json(`select jsonb_build_object('user_id',user_id,'aal',aal,'factor_id',factor_id,
        'methods',(select jsonb_agg(authentication_method order by authentication_method) from auth.mfa_amr_claims where session_id='${sessionId}'))
        from auth.sessions where id='${sessionId}' and user_id='${user.id}';`),
      ),
  });
  async function login() {
    await page.getByLabel('Email address').fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in securely' }).click();
  }
  async function verify() {
    await page.getByRole('heading', { name: 'Verify your authenticator', exact: true }).waitFor();
    const deadline = Date.now() + 35_000;
    while (currentTotp(secret) === usedCode && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 250));
    const code = currentTotp(secret);
    assert.notEqual(code, usedCode);
    usedCode = code;
    await page.getByLabel('Verification code', { exact: true }).fill(code);
    await page
      .getByRole('button', { name: 'Verify and create administrator', exact: true })
      .click();
  }
  async function noCredential() {
    assert.equal(await page.getByAltText('Authenticator setup QR code').count(), 0);
    assert.equal(await page.locator('.manual-secret').count(), 0);
    assert.equal(await page.getByLabel('Verification code', { exact: true }).count(), 0);
  }
  try {
    await page.goto(origin);
    await login();
    if (!enrollment && name !== 'lookup') await verify();
    await page
      .getByRole('heading', {
        name: name === 'bootstrap' ? 'Access could not be verified' : 'Onboarding is blocked',
        exact: true,
      })
      .waitFor();
    await noCredential();
    assert.equal(state.hits, 1);
    assert.equal(state.upstreamFaults, name.endsWith('-lost') || name === 'assurance' ? 1 : 0);
    const started = state.commands.find(({ input }) => input.action === 'start');
    assert.ok(started);
    const failed = snapshot();
    if (name !== 'bootstrap') {
      assert.deepEqual(failed, started.after);
      assert.equal(state.commands.filter(({ input }) => input.action === 'complete').length, 0);
    }
    const factors = inventory();
    if (name === 'enroll-lost') {
      assert.equal(factors.length, 1);
      assert.equal(factors[0].status, 'unverified');
    } else assert.deepEqual(factors, originalFactors);
    const count = state.requests.length;
    await page.waitForTimeout(500);
    assert.equal(state.requests.length, count);
    assert.equal(state.hits, 1);
    evidence.captureParents();
    if (cleanupProbe) {
      passed = true;
      return;
    }
    state.armed = false;
    if (name === 'bootstrap') {
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Cancel and sign out', exact: true }).click();
      await login();
      if (name === 'enroll-lost') {
        await page
          .getByRole('heading', { name: 'Administrator review is required', exact: true })
          .waitFor();
        assert.deepEqual(inventory(), factors);
        assert.equal(
          state.requests.filter(
            ({ path, method }) => path === '/auth/v1/factors' && method === 'POST',
          ).length,
          1,
        );
        assert.equal(snapshot().members.length, 0);
        assert.equal(state.commands.filter(({ input }) => input.action === 'complete').length, 0);
        passed = true;
        return;
      }
      if (name === 'enroll') {
        await page.getByRole('button', { name: 'Show manual setup key' }).click();
        secret = (await page.getByLabel('Manual authenticator setup key').textContent()).trim();
        await page.getByLabel('Verification code', { exact: true }).fill(currentTotp(secret));
        await page
          .getByRole('button', { name: 'Verify and create administrator', exact: true })
          .click();
      } else await verify();
    }
    await page.getByRole('heading', { name: 'Administration dashboard', exact: true }).waitFor();
    const complete = state.commands.filter(({ input }) => input.action === 'complete');
    assert.equal(complete.length, 1);
    const record = complete[0];
    assertProviderCompletion(record.before, record.after, record.result, {
      userId: user.id,
      organizationId,
      grantId,
      key: record.input.idempotencyKey,
      authenticationMethods: providerAuthenticationMethods(record.token, user.id),
      adminRoleId: evidence.json("select to_jsonb(id) from public.roles where code='admin';"),
    });
    if (name === 'bootstrap') assertUnchangedAuthority(failed, snapshot());
    assert.equal(
      snapshot().events.filter((event) => event.event_name === 'admin_onboarding.completed').length,
      1,
    );
    assert.equal(inventory().length, 1);
    assert.equal(inventory()[0].status, 'verified');
    passed = true;
  } finally {
    try {
      assert.equal(state.failed, false);
      assert.equal(leaked, false);
      evidence.captureParents();
      evidence.assertAuthority();
    } finally {
      await page.close();
      secret = undefined;
      if (!cleanupProbe) clearScenario(grantId, user.id);
    }
    if (passed) reportDiagnostic(cleanupProbe ? 'uncertainty-interruption' : stage, 'passed');
  }
}
