import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';

import { chromium } from '@playwright/test';

const projectEnvironment = {
  ...process.env,
  VITE_SUPABASE_URL: 'http://127.0.0.1:55321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
};

const viteProcess = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4173'],
  {
    env: projectEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

const studentContext = {
  memberships: [
    {
      membershipId: '10000000-0000-4000-8000-000000000001',
      organizationId: '20000000-0000-4000-8000-000000000001',
      organizationName: 'Synthetic Flight School',
      role: 'student_pilot',
      permissions: ['portal.student.access'],
      membershipVersion: 1,
      requiredAssuranceLevel: 'aal1',
      accessStatus: 'granted',
    },
  ],
  correlationId: '30000000-0000-4000-8000-000000000001',
  decision: 'granted',
  currentAssuranceLevel: 'aal1',
  selectedOrganizationId: null,
  organizationIds: ['20000000-0000-4000-8000-000000000001'],
};

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const accessToken = `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url({
  sub: '40000000-0000-4000-8000-000000000001',
  role: 'authenticated',
  aal: 'aal1',
  exp: Math.floor(Date.now() / 1000) + 3600,
})}.synthetic-signature`;

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:4173');
      if (response.ok) return;
    } catch {
      // The bounded retry loop handles startup races.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The FEAT-001 E2E server did not start within 15 seconds.');
}

async function mockSupabase(page, options = {}) {
  await page.route('**/auth/v1/token?grant_type=password', async (route) => {
    if (options.invalid) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error_code: 'invalid_credentials',
          msg: 'Invalid login credentials',
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'synthetic-refresh-token',
        user: {
          id: '40000000-0000-4000-8000-000000000001',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'student@example.test',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }),
    });
  });
  await page.route('**/functions/v1/auth-bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        options.empty
          ? { ...studentContext, memberships: [], decision: 'denied', organizationIds: [] }
          : studentContext,
      ),
    });
  });
  await page.route('**/functions/v1/organization-admin-onboarding', async (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.action, 'status');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        grants: [],
        correlationId: '30000000-0000-4000-8000-000000000010',
      }),
    });
  });
  await page.route('**/auth/v1/logout*', async (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/auth/v1/recover*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/auth/v1/verify*', async (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.type, 'recovery');
    assert.equal(body.token_hash, 'synthetic-recovery-token-hash-1234567890');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'synthetic-recovery-refresh-token',
        user: {
          id: '40000000-0000-4000-8000-000000000001',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'student@example.test',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }),
    });
  });
  await page.route('**/auth/v1/user*', async (route) => {
    assert.ok(['GET', 'PUT'].includes(route.request().method()));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '40000000-0000-4000-8000-000000000001',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'student@example.test',
        email_confirmed_at: new Date().toISOString(),
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        identities: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
  });
}

async function submitLogin(page) {
  await page.getByLabel('Email address').fill('student@example.test');
  await page.getByLabel('Password', { exact: true }).fill('SyntheticPassword1!');
  await page.getByRole('button', { name: 'Sign in securely' }).click();
}

async function runScenario(browser, viewport, scenario) {
  const page = await browser.newPage({ viewport });
  try {
    await page.addInitScript(() => localStorage.clear());
    await mockSupabase(page, scenario.options);
    await page.goto(
      scenario.name === 'recovery'
        ? 'http://127.0.0.1:4173/auth/forgot-password'
        : scenario.name === 'invitation'
          ? `http://127.0.0.1:4173/auth/invitation?invitation=40000000-0000-4000-8000-000000000001&version=2#access_token=${encodeURIComponent(accessToken)}&refresh_token=synthetic-invitation-refresh-token&expires_in=3600&token_type=bearer&type=invite`
          : 'http://127.0.0.1:4173',
    );

    if (scenario.name === 'viewport') {
      for (const label of ['Email address', 'Password']) {
        const locator = page.getByLabel(label, { exact: label === 'Password' });
        await locator.waitFor();
        assert.equal(
          await locator.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= globalThis.innerHeight;
          }),
          true,
        );
      }
      return;
    }

    if (scenario.name === 'recovery') {
      await page.getByLabel('Email address').fill('student@example.test');
      await page.getByRole('button', { name: 'Send recovery instructions' }).click();
      const acknowledgementHeading = page.getByRole('heading', {
        name: 'Recovery request received',
      });
      await acknowledgementHeading.waitFor();
      assert.equal(
        await acknowledgementHeading.evaluate(
          (element) => element === globalThis.document.activeElement,
        ),
        true,
      );
      await page.goto(
        'http://127.0.0.1:4173/auth/recovery?token_hash=synthetic-recovery-token-hash-1234567890',
      );
      const confirmationHeading = page.getByRole('heading', {
        name: 'Continue password recovery?',
      });
      await confirmationHeading.waitFor();
      assert.equal(
        await confirmationHeading.evaluate(
          (element) => element === globalThis.document.activeElement,
        ),
        true,
      );
      assert.equal(new URL(page.url()).search, '');
      await page.getByRole('button', { name: 'Continue securely' }).click();
      const passwordHeading = page.getByRole('heading', { name: 'Protect your account' });
      await passwordHeading.waitFor();
      assert.equal(
        await passwordHeading.evaluate((element) => element === globalThis.document.activeElement),
        true,
      );
      await page.getByLabel('New password', { exact: true }).fill('a secure synthetic password');
      await page
        .getByLabel('Confirm new password', { exact: true })
        .fill('a secure synthetic password');
      await page.getByRole('button', { name: 'Change password and end sessions' }).click();
      const completeHeading = page.getByRole('heading', { name: 'Your password has changed' });
      await completeHeading.waitFor();
      assert.equal(
        await completeHeading.evaluate((element) => element === globalThis.document.activeElement),
        true,
      );
      for (const heading of [
        'Student workspace',
        'Instructor workspace',
        'Administration workspace',
      ]) {
        assert.equal(await page.getByRole('heading', { name: heading }).count(), 0);
      }
      return;
    }

    if (scenario.name === 'invitation') {
      const heading = page.getByRole('heading', { name: 'Review and accept' });
      await heading.waitFor();
      assert.equal(
        await heading.evaluate((element) => element === globalThis.document.activeElement),
        true,
      );
      assert.equal(new URL(page.url()).search, '');
      for (const locator of [
        page.getByLabel('FlyEye password'),
        page.getByRole('button', { name: 'Accept invitation' }),
      ]) {
        assert.equal(
          await locator.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= globalThis.innerHeight;
          }),
          true,
        );
      }
      return;
    }

    await submitLogin(page);
    if (scenario.name === 'student') {
      await page.getByRole('heading', { name: 'Student workspace' }).waitFor();
      await page.getByText('Synthetic Flight School').waitFor();
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.getByRole('heading', { name: 'Sign in to FlyEye' }).waitFor();
    } else if (scenario.name === 'invalid') {
      await page
        .getByText('The email or password is incorrect, or access is unavailable.')
        .waitFor();
      assert.equal(await page.getByText(/account does not exist/i).count(), 0);
    } else if (scenario.name === 'empty') {
      await page.getByRole('heading', { name: 'Your account is not assigned' }).waitFor();
      await page.getByRole('button', { name: 'Return to sign in' }).click();
    }
  } finally {
    await page.close();
  }
}

const scenarios = [
  { name: 'student', options: {} },
  { name: 'invalid', options: { invalid: true } },
  { name: 'empty', options: { empty: true } },
  { name: 'viewport', options: {} },
  { name: 'recovery', options: {} },
  { name: 'invitation', options: {} },
];
const viewports = [
  { name: 'desktop', size: { width: 1280, height: 720 } },
  { name: 'mobile', size: { width: 393, height: 851 } },
];

try {
  await waitForServer();
  const browser = await chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true,
  });
  try {
    for (const viewport of viewports) {
      for (const scenario of scenarios) {
        await runScenario(browser, viewport.size, scenario);
        process.stdout.write(`PASS ${viewport.name}: ${scenario.name}\n`);
      }
    }
  } finally {
    await browser.close();
  }
  process.stdout.write('12 Playwright E2E scenarios passed.\n');
} finally {
  viteProcess.kill();
}
