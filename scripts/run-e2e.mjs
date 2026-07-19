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
  await page.route('**/auth/v1/logout*', async (route) => route.fulfill({ status: 204, body: '' }));
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
    await page.goto('http://127.0.0.1:4173');

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
];
const viewports = [
  { name: 'desktop', size: { width: 1280, height: 720 } },
  { name: 'mobile', size: { width: 393, height: 851 } },
];

try {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
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
  process.stdout.write('8 Playwright E2E scenarios passed.\n');
} finally {
  viteProcess.kill();
}
