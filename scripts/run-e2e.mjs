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
      roleLabel: 'Student Pilot',
      workspacePermission: 'portal.student.access',
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

const adminContext = {
  ...studentContext,
  memberships: [
    {
      ...studentContext.memberships[0],
      role: 'admin',
      roleLabel: 'Organization Admin',
      workspacePermission: 'portal.admin.access',
      permissions: [
        'portal.admin.access',
        'membership.invitation.manage',
        'membership.member.review',
        'membership.member.manage_status',
        'membership.role.assign',
      ],
      requiredAssuranceLevel: 'aal2',
    },
  ],
  currentAssuranceLevel: 'aal2',
};

const targetMember = {
  membershipId: '10000000-0000-4000-8000-000000000002',
  displayName: 'Synthetic Member',
  email: 'member@example.test',
  roleCode: 'student_pilot',
  roleLabel: 'Student Pilot',
  status: 'active',
  membershipVersion: 1,
  profileVersion: 1,
  profileComplete: true,
  createdAt: '2026-08-11T00:00:00Z',
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
          : options.privilegedMissingMfa
            ? {
                ...adminContext,
                memberships: adminContext.memberships.map((membership) => ({
                  ...membership,
                  accessStatus: 'mfa_required',
                })),
                decision: 'mfa_required',
                currentAssuranceLevel: 'aal1',
              }
            : options.admin
              ? adminContext
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
  await page.route('**/functions/v1/member-mfa', async (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.action, 'status');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        decision: 'available',
        organizationId: studentContext.memberships[0].organizationId,
        organizationName: studentContext.memberships[0].organizationName,
        membershipId: studentContext.memberships[0].membershipId,
        ready: !options.privilegedMissingMfa,
        factorState: options.privilegedMissingMfa ? 'enrollment_required' : 'challenge_required',
        correlationId: '30000000-0000-4000-8000-000000000030',
      }),
    });
  });
  await page.route('**/functions/v1/member-administration', async (route) => {
    const body = route.request().postDataJSON();
    const correlationId = '30000000-0000-4000-8000-000000000020';
    const organizationId = '20000000-0000-4000-8000-000000000001';
    const ownMembershipId = '10000000-0000-4000-8000-000000000001';
    const ownProfile = {
      organizationId,
      organizationName: 'Synthetic Flight School',
      membershipId: ownMembershipId,
      displayName: body.action === 'update_profile' ? body.displayName : 'Synthetic Student',
      contactNumber: body.action === 'update_profile' ? body.contactNumber || null : null,
      email: 'student@example.test',
      roleCode: options.admin ? 'admin' : 'student_pilot',
      roleLabel: options.admin ? 'Organization Admin' : 'Student Pilot',
      status: 'active',
      version: body.action === 'update_profile' ? 2 : 1,
      complete: true,
    };
    const responses = {
      list: {
        decision: 'listed',
        organizationId,
        members: [targetMember],
        correlationId,
      },
      detail: {
        decision: 'found',
        organizationId,
        member: {
          ...targetMember,
          contactNumber: '+63 900 000 0000',
          statusReasonOptions: [
            {
              action: 'suspend',
              code: 'temporary_access_hold',
              label: 'Temporary access hold',
            },
            {
              action: 'suspend',
              code: 'administrative_review',
              label: 'Administrative review',
            },
            { action: 'revoke', code: 'membership_ended', label: 'Membership ended' },
            {
              action: 'revoke',
              code: 'membership_created_in_error',
              label: 'Membership created in error',
            },
          ],
          roleOptions: [
            { code: 'instructor_pilot', label: 'Instructor Pilot', requiresMfa: true },
            { code: 'admin', label: 'Organization Admin', requiresMfa: true },
          ],
          roleReasonOptions: [
            { code: 'responsibility_changed', label: 'Responsibility changed' },
            { code: 'assignment_corrected', label: 'Assignment corrected' },
          ],
          updatedAt: '2026-08-11T00:00:00Z',
        },
        correlationId,
      },
      get_profile: { decision: 'found', profile: ownProfile, correlationId },
      update_profile: { decision: 'updated', profile: ownProfile, correlationId },
      suspend: {
        decision: 'suspended',
        membershipId: targetMember.membershipId,
        organizationId,
        status: 'suspended',
        roleCode: targetMember.roleCode,
        roleLabel: targetMember.roleLabel,
        version: 2,
        replayed: false,
        correlationId,
      },
      assign_role: {
        decision: 'changed',
        organizationId,
        membershipId: targetMember.membershipId,
        roleCode: 'instructor_pilot',
        roleLabel: 'Instructor Pilot',
        version: 2,
        replayed: false,
        correlationId,
      },
    };
    assert.ok(Object.hasOwn(responses, body.action));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responses[body.action]),
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
        'Student dashboard',
        'Instructor dashboard',
        'Administration dashboard',
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
      await page.getByRole('heading', { name: 'Student dashboard' }).waitFor();
      await page.getByRole('banner').getByText('Synthetic Flight School').waitFor();
      assert.equal(await page.getByText('Secure school access').count(), 0);
      assert.equal(await page.getByRole('navigation', { name: 'Primary navigation' }).count(), 1);
      assert.equal(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.document.documentElement.clientWidth,
        ),
        true,
      );
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
    } else if (scenario.name === 'profile') {
      await page.getByRole('button', { name: 'My profile', exact: true }).click();
      await page.getByRole('heading', { name: 'My basic profile' }).waitFor();
      await page.getByLabel('Display name').fill('Updated Synthetic Student');
      await page.getByLabel('Contact number (optional)').fill('+63 917 000 0000');
      await page.getByRole('button', { name: 'Save profile' }).click();
      await page.getByText('Your organization profile was saved.').waitFor();
    } else if (scenario.name === 'security') {
      await page.getByRole('button', { name: 'Account security', exact: true }).click();
      const heading = page.getByRole('heading', { name: 'Authenticator is ready' });
      await heading.waitFor();
      assert.equal(
        await heading.evaluate((element) => element === globalThis.document.activeElement),
        true,
      );
      assert.equal(await page.getByText(/does not change your role/i).count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Return to workspace' }).count(), 1);
    } else if (scenario.name === 'privileged-security') {
      const heading = page.getByRole('heading', { name: 'Set up an authenticator' });
      await heading.waitFor();
      assert.equal(
        await heading.evaluate((element) => element === globalThis.document.activeElement),
        true,
      );
      assert.equal(await page.getByText(/does not change your role/i).count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Begin secure setup' }).count(), 1);
    } else if (scenario.name === 'members') {
      await page.getByRole('heading', { name: 'Administration dashboard' }).waitFor();
      await page.getByRole('button', { name: 'People', exact: true }).click();
      await page.getByRole('heading', { name: 'Organization members' }).waitFor();
      await page.getByRole('button', { name: /Synthetic Member/ }).click();
      await page.getByRole('button', { name: 'Change FlyEye role' }).click();
      await page.getByRole('heading', { name: "Replace this member's FlyEye role?" }).waitFor();
      await page.getByText(/does not verify aviation qualification/i).waitFor();
      await page.getByRole('button', { name: 'Confirm role change' }).click();
      await page.getByText('Role changed to Instructor Pilot successfully.').waitFor();
      await page.getByRole('button', { name: /Synthetic Member/ }).click();
      await page.getByRole('button', { name: 'suspend membership' }).click();
      await page.getByRole('heading', { name: 'suspend this membership?' }).waitFor();
      await page.getByRole('button', { name: 'Confirm suspend' }).click();
      await page.getByText('Membership suspended successfully.').waitFor();
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
  { name: 'profile', options: {} },
  { name: 'security', options: {} },
  { name: 'privileged-security', options: { privilegedMissingMfa: true } },
  { name: 'members', options: { admin: true } },
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
  process.stdout.write(`${scenarios.length * viewports.length} Playwright E2E scenarios passed.\n`);
} finally {
  viteProcess.kill();
}
