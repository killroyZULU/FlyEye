import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { memberMfaBrowser } from './member-mfa-browser.mjs';
import { issueGrant } from './onboarding-provider-cases.mjs';
import {
  assertProviderCompletion,
  providerAuthenticationMethods,
} from './onboarding-provider-evidence.mjs';
import {
  assertCurrentFactorDenial,
  replaceCurrentFactor,
  sessionIdentity,
} from './onboarding-current-factor-evidence.mjs';

export function onboardingCurrentFactorBrowser() {
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
      const user = context.users.at(-1);
      const grantId = randomUUID();
      issueGrant(context.psql, context.organizationId, user.id, grantId, context.sourceInstanceId);
      const snapshot = () => context.evidence.snapshot(user.id, grantId);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.setDefaultTimeout(15_000);
      const commands = [];
      let armed = true;
      let replacement;
      let oldSessionId;
      let failed = false;
      let leaked = false;
      let requests = 0;
      let originalSecret;
      page.on('console', (message) => {
        const value = message.text();
        if (
          value.includes('otpauth://') ||
          [originalSecret, replacement?.factor.secret].some(
            (secret) => secret && value.includes(secret),
          )
        )
          leaked = true;
      });
      await page.route(`${new URL(context.apiUrl).origin}/**`, async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() === 'OPTIONS') return route.continue();
        requests++;
        try {
          if (armed && path.endsWith('/verify') && request.method() === 'POST') {
            const response = await route.fetch({ maxRetries: 0, timeout: 15_000 });
            assert.equal(response.status(), 200);
            const data = await response.json();
            oldSessionId = sessionIdentity(data.access_token, user.id);
            providerAuthenticationMethods(data.access_token, user.id);
            context.evidence.captureParents();
            const factorId = path.split('/').at(-2);
            replacement = await replaceCurrentFactor(context, user, { factorId });
            armed = false;
            // Deliver the real verification response unchanged, after replacement commits.
            await route.fulfill({ response });
          } else if (path.startsWith('/functions/v1/') && request.method() === 'POST') {
            const before = snapshot();
            const response = await route.fetch({ maxRetries: 0, timeout: 15_000 });
            commands.push({
              input: request.postDataJSON(),
              before,
              after: snapshot(),
              result: { status: response.status(), payload: await response.json() },
              token: request.headers().authorization?.slice(7),
            });
            await route.fulfill({ response });
          } else await route.continue();
        } catch {
          failed = true;
          await route.abort().catch(() => {});
        }
      });
      const login = async () => {
        await page.getByLabel('Email address').fill(user.email);
        await page.getByLabel('Password', { exact: true }).fill(context.password);
        await page.getByRole('button', { name: 'Sign in securely' }).click();
      };
      try {
        context.enterStage('current-browser', 'delayed original verification response');
        await page.goto(context.origin);
        await login();
        await page.getByRole('button', { name: 'Show manual setup key' }).click();
        originalSecret = (
          await page.getByLabel('Manual authenticator setup key').textContent()
        ).trim();
        await page
          .getByLabel('Verification code', { exact: true })
          .fill(context.currentTotp(originalSecret));
        await page
          .getByRole('button', { name: 'Verify and create administrator', exact: true })
          .click();
        await page.getByRole('heading', { name: 'Onboarding is blocked', exact: true }).waitFor();
        const denied = commands.filter((entry) => entry.input.action === 'complete');
        assert.equal(denied.length, 1);
        assertCurrentFactorDenial(denied[0].before, denied[0].after, denied[0].result, {
          userId: user.id,
          grantId,
        });
        assert.equal(sessionIdentity(denied[0].token, user.id), oldSessionId);
        assert.equal(await page.getByAltText('Authenticator setup QR code').count(), 0);
        assert.equal(await page.locator('.manual-secret').count(), 0);
        const count = requests;
        await page.waitForTimeout(500);
        assert.equal(requests, count);
        assert.equal(snapshot().members.length, 0);
        await page.getByRole('button', { name: 'Cancel and sign out', exact: true }).click();
        await new Promise((resolve) => setTimeout(resolve, 20_100));
        await login();
        await page
          .getByRole('heading', { name: 'Verify your authenticator', exact: true })
          .waitFor();
        const deadline = Date.now() + 35_000;
        while (
          context.currentTotp(replacement.factor.secret) === replacement.factor.usedCode &&
          Date.now() < deadline
        )
          await new Promise((resolve) => setTimeout(resolve, 250));
        const code = context.currentTotp(replacement.factor.secret);
        assert.notEqual(code, replacement.factor.usedCode);
        await page.getByLabel('Verification code', { exact: true }).fill(code);
        await page
          .getByRole('button', { name: 'Verify and create administrator', exact: true })
          .click();
        await page
          .getByRole('heading', { name: 'Administration dashboard', exact: true })
          .waitFor();
        const all = commands.filter((entry) => entry.input.action === 'complete');
        assert.equal(all.length, 2);
        const success = all[1];
        assert.notEqual(sessionIdentity(success.token, user.id), oldSessionId);
        assertProviderCompletion(success.before, success.after, success.result, {
          userId: user.id,
          organizationId: context.organizationId,
          grantId,
          key: success.input.idempotencyKey,
          authenticationMethods: providerAuthenticationMethods(success.token, user.id),
          adminRoleId: context.evidence.json(
            "select to_jsonb(id) from public.roles where code='admin';",
          ),
        });
        assert.equal(failed, false);
        assert.equal(leaked, false);
      } finally {
        context.evidence.captureParents();
        context.evidence.assertAuthority();
        await page.close();
        originalSecret = undefined;
        replacement = undefined;
        context.clearScenario(grantId, user.id);
      }
      context.reportDiagnostic('current-browser', 'passed');
    },
  };
}
