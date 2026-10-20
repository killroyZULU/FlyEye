import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { memberMfaBrowser } from './member-mfa-browser.mjs';
import { issueGrant } from './onboarding-provider-cases.mjs';
import { assertStaleTransition, assertFactorRequests } from './onboarding-stale-evidence.mjs';
import { observeOnboardingLogin } from './onboarding-login-diagnostics.mjs';

export function onboardingStaleBrowser() {
  // Reuse the existing isolated production-preview lifecycle; its member journey is not run.
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
      const {
        users,
        organizationId,
        sourceInstanceId,
        psql,
        admin,
        signIn,
        invoke,
        evidence,
        origin,
        apiUrl,
        password,
        enterStage,
        reportDiagnostic,
        cleanupProbe,
      } = context;
      browser = await chromium.launch({ headless: true });
      for (const index of cleanupProbe ? [1] : [0, 1]) {
        const existing = index === 0;
        const user = users[index];
        const grantId = randomUUID();
        const details = { userId: user.id, organizationId, grantId };
        const snapshot = () => evidence.snapshot(user.id, grantId);
        enterStage('stale-issuance', 'stale factor synthetic issuance');
        issueGrant(psql, organizationId, user.id, grantId, sourceInstanceId);
        const inventory = async () => {
          const result = await admin.auth.admin.mfa.listFactors({ userId: user.id });
          assert.equal(Boolean(result.error), false);
          return result.data.factors.map(({ id, factor_type, status }) => ({
            id,
            factor_type,
            status,
          }));
        };
        let signedIn;
        let factors;
        if (existing) {
          enterStage('stale-seed-factor', 'pre-existing unverified factor');
          signedIn = await signIn(user);
          const enrolled = await signedIn.client.auth.mfa.enroll({
            factorType: 'totp',
            friendlyName: 'Synthetic stale onboarding',
          });
          assert.equal(Boolean(enrolled.error), false);
          factors = [{ id: enrolled.data.id, factor_type: 'totp', status: 'unverified' }];
          assert.deepEqual(await inventory(), factors);
          evidence.captureParents();
        }
        const page = await browser.newPage({
          viewport: existing ? { width: 1280, height: 800 } : { width: 393, height: 851 },
        });
        page.setDefaultTimeout(15_000);
        const counts = { enroll: 0, challenge: 0, verify: 0, remove: 0, complete: 0 };
        const records = [];
        const loginDiagnostics = observeOnboardingLogin(page, reportDiagnostic, apiUrl);
        let routeFailed = false;
        let leaked = false;
        let secret;
        page.on('console', (message) => {
          const text = message.text();
          if (text.includes('otpauth://') || (secret && text.includes(secret))) leaked = true;
        });
        page.on('request', (request) => {
          const pathname = new URL(request.url()).pathname;
          if (pathname === '/auth/v1/factors' && request.method() === 'POST') counts.enroll++;
          if (pathname.startsWith('/auth/v1/factors/')) {
            if (request.method() === 'DELETE') counts.remove++;
            if (pathname.endsWith('/challenge') && request.method() === 'POST') counts.challenge++;
            if (pathname.endsWith('/verify') && request.method() === 'POST') counts.verify++;
          }
        });
        // Snapshot before forwarding the real command. No response or request body is mocked.
        await page.route('**/functions/v1/organization-admin-onboarding', async (route) => {
          try {
            if (route.request().method() === 'POST') {
              const input = route.request().postDataJSON();
              if (input.action === 'complete') counts.complete++;
              records.push({ input, before: snapshot() });
            }
            await route.continue();
          } catch {
            routeFailed = true;
            await route.abort().catch(() => {});
          }
        });
        const responseFor = (action) =>
          page
            .waitForResponse(
              (response) =>
                new URL(response.url()).pathname ===
                  '/functions/v1/organization-admin-onboarding' &&
                response.request().method() === 'POST' &&
                response.request().postDataJSON().action === action,
            )
            .then(
              (value) => ({ value }),
              (error) => ({ error }),
            );
        async function assertResponse(settled, kind) {
          if (settled.error) throw settled.error;
          assert.equal(routeFailed, false);
          const response = settled.value;
          const input = response.request().postDataJSON();
          const record = records.findLast(
            (entry) => entry.input.idempotencyKey === input.idempotencyKey,
          );
          assert.ok(record);
          assertStaleTransition(
            kind,
            record.before,
            snapshot(),
            { status: response.status(), payload: await response.json() },
            { ...details, key: input.idempotencyKey },
          );
        }
        async function noCredential() {
          assert.equal(await page.locator('.manual-secret').count(), 0);
          assert.equal(await page.getByAltText('Authenticator setup QR code').count(), 0);
          assert.equal(
            await page.getByRole('button', { name: 'Show manual setup key' }).count(),
            0,
          );
          assert.equal(
            await page.getByRole('heading', { name: 'Administration dashboard' }).count(),
            0,
          );
        }
        async function login(blocked) {
          enterStage('stale-browser-login', 'stale factor browser sign-in');
          const response = responseFor('start');
          loginDiagnostics.begin();
          try {
            enterStage('stale-login-email', 'stale factor email control');
            await page.getByLabel('Email address').fill(user.email);
            enterStage('stale-login-password', 'stale factor password control');
            await page.getByLabel('Password', { exact: true }).fill(password);
            enterStage('stale-login-submit', 'stale factor sign-in submit');
            await page.getByRole('button', { name: 'Sign in securely' }).click();
            enterStage('stale-login-start-response', 'stale factor onboarding start response');
            await assertResponse(await response, blocked ? 'entry' : 'start');
            if (blocked) {
              enterStage('stale-login-review-heading', 'stale factor review heading');
              await page
                .getByRole('heading', { name: 'Administrator review is required', exact: true })
                .waitFor();
              enterStage('stale-login-review-guidance', 'stale factor review guidance');
              await page
                .getByText('Your administrator onboarding information needs review.', {
                  exact: true,
                })
                .waitFor();
              await noCredential();
            } else {
              enterStage('stale-login-enrollment-heading', 'stale factor enrollment heading');
              await page
                .getByRole('heading', { name: 'Set up your authenticator', exact: true })
                .waitFor();
            }
          } finally {
            loginDiagnostics.finish();
          }
        }
        try {
          await page.goto(origin);
          await login(existing);
          if (existing) {
            assert.deepEqual(await inventory(), factors);
            enterStage('stale-api-cancel', 'stale factor protected cancellation and replay');
            const key = randomBytes(16).toString('hex');
            for (const kind of ['cancel', 'replay']) {
              const before = snapshot();
              const result = await invoke(
                'organization-admin-onboarding',
                signedIn.session.access_token,
                { action: 'cancel', bootstrapGrantId: grantId, idempotencyKey: key },
              );
              assertStaleTransition(kind, before, snapshot(), result, { ...details, key });
              assert.deepEqual(await inventory(), factors);
            }
            assertFactorRequests(counts, 0);
          } else {
            enterStage('stale-browser-enrolled', 'real unverified enrollment');
            await page.getByRole('button', { name: 'Show manual setup key' }).click();
            secret = (await page.getByLabel('Manual authenticator setup key').textContent()).trim();
            assert.match(secret, /^[A-Z2-7]{16,256}=*$/i);
            factors = await inventory();
            assert.equal(factors.length, 1);
            assert.equal(factors[0].factor_type, 'totp');
            assert.equal(factors[0].status, 'unverified');
            evidence.captureParents();
            if (cleanupProbe) {
              reportDiagnostic('stale-interruption', 'passed');
              return;
            }
            enterStage('stale-browser-cancel', 'real cancellation and sign-out');
            const cancelled = responseFor('cancel');
            await page.getByRole('button', { name: 'Cancel and sign out' }).click();
            await assertResponse(await cancelled, 'cancel');
            await page.getByRole('button', { name: 'Sign in securely' }).waitFor();
            await noCredential();
            assert.equal(
              await page.evaluate(() =>
                Object.keys(localStorage).some((key) => /^sb-.*-auth-token$/.test(key)),
              ),
              false,
            );
            assert.deepEqual(await inventory(), factors);
            enterStage('stale-reentry', 'cancelled enrollment re-entry');
            await login(true);
            assert.deepEqual(await inventory(), factors);
            assertFactorRequests(counts, 1);
          }
          assert.deepEqual(
            records.map(({ input }) => input.action),
            existing ? ['status', 'start'] : ['status', 'start', 'cancel', 'status', 'start'],
          );
          assert.equal(leaked, false);
          evidence.captureParents();
          evidence.assertAuthority();
          reportDiagnostic(
            existing ? 'stale-existing-passed' : 'stale-cancel-reentry-passed',
            'passed',
          );
        } finally {
          loginDiagnostics.dispose();
          try {
            evidence.captureParents();
          } finally {
            await page.close();
            secret = undefined;
          }
        }
      }
    },
  };
}
