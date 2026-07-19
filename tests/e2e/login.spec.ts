import { chromium, expect, test, type Browser, type Page } from '@playwright/test';

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

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const accessToken = `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url({
  sub: '40000000-0000-4000-8000-000000000001',
  role: 'authenticated',
  aal: 'aal1',
  exp: Math.floor(Date.now() / 1000) + 3600,
})}.synthetic-signature`;

async function mockSupabase(page: Page, options: { invalid?: boolean; empty?: boolean } = {}) {
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
          ? {
              ...studentContext,
              memberships: [],
              decision: 'denied',
              organizationIds: [],
            }
          : studentContext,
      ),
    });
  });

  await page.route('**/auth/v1/logout*', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });
}

async function submitLogin(page: Page) {
  await page.getByLabel('Email address').fill('student@example.test');
  await page.getByLabel('Password', { exact: true }).fill('SyntheticPassword1!');
  await page.getByRole('button', { name: 'Sign in securely' }).click();
}

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});

test.beforeEach(async ({ browserName }, testInfo) => {
  if (browserName !== 'chromium') throw new Error('FEAT-001 E2E requires a Chromium browser.');
  page = await browser.newPage({
    viewport:
      testInfo.project.name === 'mobile'
        ? { width: 393, height: 851 }
        : { width: 1280, height: 720 },
  });
  await page.addInitScript(() => localStorage.clear());
});

test.afterEach(async () => {
  await page.close();
});

test.afterAll(async () => {
  await browser.close();
});

test('student signs in and reaches the server-authorized workspace', async () => {
  await mockSupabase(page);
  await page.goto('/');
  await submitLogin(page);

  await expect(page.getByRole('heading', { name: 'Student workspace' })).toBeVisible();
  await expect(page.getByText('Synthetic Flight School')).toBeVisible();
  await expect(
    page.getByText('Workspace features are intentionally outside FEAT-001.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to FlyEye' })).toBeVisible();
});

test('invalid credentials use a non-enumerating error', async () => {
  await mockSupabase(page, { invalid: true });
  await page.goto('/');
  await submitLogin(page);

  await expect(
    page.getByText('The email or password is incorrect, or access is unavailable.'),
  ).toBeVisible();
  await expect(page.getByText(/account does not exist/i)).toHaveCount(0);
});

test('authenticated account without membership sees the empty state', async () => {
  await mockSupabase(page, { empty: true });
  await page.goto('/');
  await submitLogin(page);

  await expect(page.getByRole('heading', { name: 'Your account is not assigned' })).toBeVisible();
  await page.getByRole('button', { name: 'Return to sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to FlyEye' })).toBeVisible();
});

test('login remains usable at the configured viewport', async () => {
  await mockSupabase(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sign in to FlyEye' })).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeInViewport();
  await expect(page.getByLabel('Password', { exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Sign in securely' })).toBeInViewport();
});
