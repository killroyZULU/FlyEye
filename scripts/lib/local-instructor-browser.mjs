import { chromium } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import { currentTotp } from './no-send-runtime-client.mjs';
import { studentOrigin, tokenClaims } from './local-student-router.mjs';
import { studentUuid } from './local-student-journal.mjs';
const check = (value) => {
  if (!value) throw new Error('Instructor browser assertion failed.');
};

export function verifyInstructorBrowser(config, candidate, mark) {
  return verifyMfaBrowser(config, candidate, mark, 'instructor_pilot');
}

export function verifyAdminBrowser(config, admin, mark) {
  return verifyMfaBrowser(config, admin, mark, 'admin');
}

async function verifyMfaBrowser({ origin, publishableKey }, candidate, mark, role) {
  check(origin === studentOrigin && candidate.email === role + '@school.invalid');
  const browser = await chromium.launch({
    headless: true,
    env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME },
  });
  let pid;
  try {
    const control = await browser.newBrowserCDPSession();
    const info = await control.send('SystemInfo.getProcessInfo');
    const processes = info.processInfo.filter((p) => p.type === 'browser');
    check(processes.length === 1 && Number.isInteger(processes[0].id) && processes[0].id > 1);
    pid = processes[0].id;
    await control.detach();
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await ctx.route('**/*', (r) =>
        new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
      );
      const page = await ctx.newPage();
      await page.goto(origin);
      await page.getByLabel('Email address').fill(candidate.email);
      await page.getByLabel('Password', { exact: true }).fill(candidate.password);
      await page.getByRole('button', { name: 'Sign in securely' }).click();
      await page.getByRole('heading', { name: 'Verify your identity' }).waitFor();
      // Enrollment may have used the current step. Wait once before the first submission.
      if (currentTotp(candidate.secret) === candidate.lastCode)
        await delay(30200 - (Date.now() % 30000));
      const code = currentTotp(candidate.secret);
      check(code !== candidate.lastCode);
      await page.getByLabel('Verification code', { exact: true }).fill(code);
      await page.getByRole('button', { name: 'Verify and continue' }).click();
      const nav = page.getByRole('navigation');
      await nav.getByRole('button', { name: 'My profile', exact: true }).waitFor();
      const endpoint = origin + '/functions/v1/member-administration';
      const [read] = await Promise.all([
        page.waitForResponse(
          (r) => r.url() === endpoint && r.request().postDataJSON()?.action === 'get_profile',
        ),
        nav.getByRole('button', { name: 'My profile', exact: true }).click(),
      ]);
      const bearer = await read.request().headerValue('authorization');
      check(bearer?.startsWith('Bearer '));
      const claims = tokenClaims(bearer.slice(7));
      check(
        claims?.sub === candidate.id &&
          claims.aal === 'aal2' &&
          claims.role === 'authenticated' &&
          studentUuid(claims.session_id) &&
          claims.session_id !== candidate.setupSessionId,
      );
      mark(role === 'admin' ? 'browser-admin-sign-in' : 'browser-instructor-sign-in');
      const data = await read.json();
      check(
        read.status() === 200 &&
          data.decision === 'found' &&
          data.profile?.membershipId === candidate.membershipId &&
          data.profile.organizationId === candidate.schoolId &&
          data.profile.email === candidate.email &&
          data.profile.roleCode === role,
      );
      await page.getByRole('heading', { name: 'My basic profile' }).waitFor();
      await page.locator('.member-form').getByText(candidate.email, { exact: true }).waitFor();
      mark('browser-exact-profile');
      if (role === 'admin') {
        const [response] = await Promise.all([
          page.waitForResponse(
            (r) => r.url() === endpoint && r.request().postDataJSON()?.action === 'list',
          ),
          nav.getByRole('button', { name: 'People', exact: true }).click(),
        ]);
        check(
          response.status() === 200 &&
            (await response.request().headerValue('authorization')) === bearer &&
            response.request().postDataJSON().organizationId === candidate.schoolId,
        );
        const listed = await response.json();
        check(
          listed.decision === 'listed' &&
            listed.organizationId === candidate.schoolId &&
            studentUuid(listed.correlationId) &&
            !listed.nextCursor &&
            listed.members.length === 2,
        );
        const list = page.getByRole('list', { name: 'Organization members' });
        for (const [membershipId, email, roleCode] of [
          [candidate.membershipId, candidate.email, 'admin'],
          [candidate.studentMembershipId, 'instructor_pilot@school.invalid', 'student_pilot'],
        ]) {
          check(
            listed.members.some(
              (m) =>
                m.membershipId === membershipId &&
                m.email === email &&
                m.roleCode === roleCode &&
                m.status === 'active',
            ),
          );
          await list.getByText(email, { exact: true }).waitFor();
        }
        mark('browser-same-school-directory');
        return;
      }
      const denied = await page.evaluate(
        async ({ bearer, publishableKey, school }) => {
          const response = await fetch('/functions/v1/member-administration', {
            method: 'POST',
            headers: {
              apikey: publishableKey,
              authorization: bearer,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ action: 'list', organizationId: school }),
          });
          const b = await response.json();
          return {
            status: response.status,
            code: b.error?.code,
            correlation: b.correlationId,
            keys: Object.keys(b).sort().join(','),
          };
        },
        { bearer, publishableKey, school: candidate.schoolId },
      );
      check(
        denied.status === 404 &&
          denied.code === 'member_administration.not_found' &&
          studentUuid(denied.correlation) &&
          denied.keys === 'correlationId,error',
      );
      mark('browser-directory-denied');
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    check(!browser.isConnected() && pid);
    let exited = false;
    try {
      process.kill(pid, 0);
    } catch (error) {
      exited = error.code === 'ESRCH';
    }
    check(exited);
  }
}
