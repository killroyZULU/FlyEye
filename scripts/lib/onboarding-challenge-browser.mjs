import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { memberMfaBrowser } from './member-mfa-browser.mjs';
import { issueGrant } from './onboarding-provider-cases.mjs';
import { assertStaleTransition } from './onboarding-stale-evidence.mjs';
import {
  assertProviderCompletion,
  assertProviderBootstrap,
  providerAuthenticationMethods,
} from './onboarding-provider-evidence.mjs';
import {
  assertPasswordOnly,
  assertForeignFactorDenied,
  assertChallengeRequests,
} from './onboarding-challenge-evidence.mjs';

export function onboardingChallengeBrowser() {
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
        signIn,
        evidence,
        origin,
        password,
        currentTotp,
        enterStage,
        reportDiagnostic,
        cleanupProbe,
      } = context;
      const [actor, foreign] = users;
      const grantId = randomUUID();
      const foreignGrantId = randomUUID();
      const details = { userId: actor.id, organizationId, grantId };
      const snapshot = () => evidence.snapshot(actor.id, grantId);
      enterStage('challenge-setup', 'owned verified-factor setup');
      issueGrant(psql, organizationId, actor.id, grantId, sourceInstanceId);
      const seeded = [];
      for (const user of users) {
        const signed = await signIn(user);
        const enrolled = await signed.client.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: 'Synthetic existing factor',
        });
        assert.equal(Boolean(enrolled.error), false);
        const verified = await signed.client.auth.mfa.challengeAndVerify({
          factorId: enrolled.data.id,
          code: currentTotp(enrolled.data.totp.secret),
        });
        assert.equal(Boolean(verified.error), false);
        seeded.push({ ...signed, id: enrolled.data.id, secret: enrolled.data.totp.secret });
        evidence.captureParents();
      }
      const [ownFactor, foreignFactor] = seeded;
      // State evidence uses the same scoped SQL channel as domain/assurance snapshots;
      // admin-list HTTP availability is not part of the challenge ownership contract.
      const inventory = () =>
        users.map(({ id }) =>
          evidence.json(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from
          (select id,factor_type,status from auth.mfa_factors where user_id='${id}') t;`),
        );
      const expectedFactors = seeded.map(({ id }) => [
        { id, factor_type: 'totp', status: 'verified' },
      ]);
      assert.deepEqual(inventory(), expectedFactors);
      const ownerChallenge = await foreignFactor.client.auth.mfa.challenge({
        factorId: foreignFactor.id,
      });
      assert.equal(Boolean(ownerChallenge.error), false);
      const foreignSnapshot = () => evidence.snapshot(foreign.id, foreignGrantId);
      const providerChallenges = () =>
        evidence.json(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from
        (select id,factor_id,created_at,verified_at from auth.mfa_challenges where factor_id in ('${ownFactor.id}','${foreignFactor.id}')) t;`);
      const providerAssurance = () =>
        evidence.json(`select jsonb_build_object(
        'sessions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from
          (select id,user_id,aal,factor_id from auth.sessions where user_id in ('${actor.id}','${foreign.id}')) t),
        'amr',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from
          (select id,session_id,authentication_method,created_at,updated_at from auth.mfa_amr_claims
            where session_id in(select id from auth.sessions where user_id in ('${actor.id}','${foreign.id}'))) t));`);
      const negativeSnapshot = async () => {
        enterStage('foreign-snapshot-actor', 'owned actor snapshot');
        const actorState = snapshot();
        enterStage('foreign-snapshot-owner', 'owned foreign factor owner snapshot');
        const ownerState = foreignSnapshot();
        enterStage('foreign-snapshot-inventory', 'factor inventory snapshot');
        const factors = inventory();
        enterStage('foreign-snapshot-challenges', 'provider challenge snapshot');
        const challenges = providerChallenges();
        enterStage('foreign-snapshot-assurance', 'server assurance snapshot');
        const assurance = providerAssurance();
        return { domain: [actorState, ownerState], factors, challenges, assurance };
      };
      const attacker = await signIn(actor);
      assertPasswordOnly(attacker.session.access_token, actor.id);
      for (const operation of ['challenge', 'verify']) {
        enterStage(`foreign-factor-${operation}`, 'foreign factor ownership denial');
        const before = await negativeSnapshot();
        enterStage('foreign-provider-request', 'provider ownership request');
        const result =
          operation === 'challenge'
            ? await attacker.client.auth.mfa.challenge({ factorId: foreignFactor.id })
            : await attacker.client.auth.mfa.verify({
                factorId: foreignFactor.id,
                challengeId: ownerChallenge.data.id,
                code: currentTotp(foreignFactor.secret),
              });
        enterStage('foreign-provider-returned', 'provider ownership response received');
        const after = await negativeSnapshot();
        assertForeignFactorDenied(before, after, result, (stage) =>
          enterStage(stage, 'foreign factor denial assertion'),
        );
        enterStage('foreign-denial-cached-assurance', 'unchanged cached assurance');
        const session = await attacker.client.auth.getSession();
        assert.equal(Boolean(session.error), false);
        assertPasswordOnly(session.data.session.access_token, actor.id);
        reportDiagnostic(`foreign-factor-${operation}-passed`, 'passed');
      }
      // Confirm the denied caller neither consumed nor invalidated the owner's real challenge.
      const ownerVerified = await foreignFactor.client.auth.mfa.verify({
        factorId: foreignFactor.id,
        challengeId: ownerChallenge.data.id,
        code: currentTotp(foreignFactor.secret),
      });
      assert.equal(Boolean(ownerVerified.error), false);
      assert.deepEqual(inventory(), expectedFactors);
      evidence.captureParents();
      const unchangedForeign = foreignSnapshot();
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.setDefaultTimeout(15_000);
      const commands = [];
      const factorRequests = [];
      let routeFailed = false;
      let interrupted = false;
      let leaked = false;
      page.on('console', (message) => {
        const text = message.text();
        if (text.includes('otpauth://') || seeded.some(({ secret }) => text.includes(secret)))
          leaked = true;
      });
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith('/auth/v1/factors'))
          factorRequests.push({ method: request.method(), path });
      });
      await page.route('**/auth/v1/factors/*/verify', async (route) => {
        if (cleanupProbe) {
          interrupted = true;
          await route.abort('aborted');
        } else await route.continue();
      });
      // Forward actual responses only after the exact post-command snapshot is captured.
      // This avoids racing the next bootstrap audit; no server result is manufactured.
      await page.route('**/functions/v1/*', async (route) => {
        try {
          const request = route.request();
          const endpoint = new URL(request.url()).pathname.split('/').at(-1);
          if (
            request.method() !== 'POST' ||
            !['auth-bootstrap', 'organization-admin-onboarding'].includes(endpoint)
          ) {
            await route.continue();
            return;
          }
          const input = request.postDataJSON();
          if (input.action === 'start')
            assertPasswordOnly(request.headers().authorization.slice(7), actor.id);
          const before = snapshot();
          const response = await route.fetch({ maxRetries: 0, timeout: 15_000 });
          const result = { status: response.status(), payload: await response.json() };
          commands.push({
            endpoint,
            input,
            before,
            after: snapshot(),
            result,
            methods:
              input.action === 'complete'
                ? providerAuthenticationMethods(request.headers().authorization.slice(7), actor.id)
                : undefined,
          });
          await route.fulfill({ response });
        } catch {
          routeFailed = true;
          await route.abort().catch(() => {});
        }
      });
      async function noCredential() {
        assert.equal(await page.locator('.manual-secret').count(), 0);
        assert.equal(await page.getByAltText('Authenticator setup QR code').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Show manual setup key' }).count(), 0);
      }
      try {
        enterStage('challenge-browser-login', 'existing verified factor browser sign-in');
        await page.goto(origin);
        await page.getByLabel('Email address').fill(actor.email);
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Sign in securely' }).click();
        await page
          .getByRole('heading', { name: 'Verify your authenticator', exact: true })
          .waitFor();
        await noCredential();
        const start = commands.find(({ input }) => input.action === 'start');
        assert.ok(start);
        assertStaleTransition('start', start.before, start.after, start.result, {
          ...details,
          key: start.input.idempotencyKey,
          factorState: 'challenge_required',
        });
        assert.deepEqual(factorRequests, []);
        const beforeChallenge = snapshot();
        const beforeAssurance = providerAssurance();
        enterStage('challenge-browser-verify', 'existing factor challenge and verification');
        const verification = cleanupProbe
          ? undefined
          : page
              .waitForResponse(
                (response) =>
                  response.request().method() === 'POST' &&
                  new URL(response.url()).pathname === `/auth/v1/factors/${ownFactor.id}/verify`,
              )
              .then(
                (response) => ({ response }),
                (error) => ({ error }),
              );
        await page
          .getByLabel('Verification code', { exact: true })
          .fill(currentTotp(ownFactor.secret));
        await page
          .getByRole('button', { name: 'Verify and create administrator', exact: true })
          .click();
        if (cleanupProbe) {
          await page.getByRole('alert').filter({ hasText: 'invalid or expired' }).waitFor();
          assert.equal(interrupted, true);
          assert.deepEqual(snapshot(), beforeChallenge);
          assert.deepEqual(providerAssurance(), beforeAssurance);
          assert.equal(
            commands.some(({ input }) => input.action === 'complete'),
            false,
          );
        } else {
          const settled = await verification;
          if (settled.error) throw settled.error;
          assert.equal(settled.response.status(), 200);
          const verified = await settled.response.json();
          providerAuthenticationMethods(verified.access_token, actor.id);
          await page
            .getByRole('heading', { name: 'Administration dashboard', exact: true })
            .waitFor();
          await noCredential();
          const complete = commands.filter(({ input }) => input.action === 'complete');
          assert.equal(complete.length, 1);
          assertProviderCompletion(complete[0].before, complete[0].after, complete[0].result, {
            ...details,
            key: complete[0].input.idempotencyKey,
            authenticationMethods: complete[0].methods,
            adminRoleId: evidence.json("select to_jsonb(id) from public.roles where code='admin';"),
          });
          const finalBootstrap = commands
            .filter(({ endpoint }) => endpoint === 'auth-bootstrap')
            .at(-1);
          assertProviderBootstrap(
            finalBootstrap.before,
            finalBootstrap.after,
            finalBootstrap.result,
            { ...details, removed: false },
          );
          assert.deepEqual(
            commands
              .filter(({ endpoint }) => endpoint === 'organization-admin-onboarding')
              .map(({ input }) => input.action),
            ['status', 'start', 'complete', 'status'],
          );
          assert.equal(commands.filter(({ endpoint }) => endpoint === 'auth-bootstrap').length, 2);
        }
        assert.equal(routeFailed, false);
        assert.equal(leaked, false);
        assertChallengeRequests(factorRequests, ownFactor.id);
        assert.deepEqual(inventory(), expectedFactors);
        assert.deepEqual(foreignSnapshot(), unchangedForeign);
        evidence.assertAuthority();
        reportDiagnostic(
          cleanupProbe ? 'challenge-interruption' : 'challenge-browser-passed',
          'passed',
        );
      } finally {
        try {
          evidence.captureParents();
        } finally {
          await page.close();
          for (const factor of seeded) factor.secret = undefined;
        }
      }
    },
  };
}
