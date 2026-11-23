import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { credentialOwnerHandler } from '../../supabase/functions/credential-owner/handler.ts';
import { currentTotp } from '../lib/no-send-runtime-client.mjs';
import { proveOwnerBrowser } from './credential-owner-browser.mjs';
import { passwordTransportMarker, requireStatus } from './credential-checkpoint-log.mjs';
import { withProofStorage } from './credential-proof-storage.mjs';
import { syntheticSample } from '../../src/features/credentials/owner-gateway.ts';

export function authorizedMetadata(result, school, member) {
  return (
    result?.decision === 'credential_workspace' &&
    result.organizationId === school &&
    result.hasMore === false &&
    result.members?.length === 1 &&
    result.members[0].membershipId === member &&
    result.members[0].applicability === 'trainee'
  );
}
// Correlate by Playwright Request identity. Observe only the checkpoint's first password POST.
export async function observePasswordPost(page, apiOrigin, mark, click) {
  const endpoint = apiOrigin + '/auth/v1/token?grant_type=password';
  let first,
    headers,
    transportFailed = false,
    active = true;
  const dispatch = (req) => {
    if (!first && req.method() === 'POST' && req.url() === endpoint) {
      first = req;
      mark('password-request-dispatched');
    }
  };
  const failed = (req) => {
    if (first && req === first && !headers && !transportFailed) {
      transportFailed = true;
      mark('password-transport-failed-before-headers');
      mark(passwordTransportMarker(req));
    }
  };
  page.on('request', dispatch);
  page.on('requestfailed', failed);
  try {
    const wait = page
      .waitForResponse((response) => {
        if (!active || !first || response.request() !== first) return false;
        headers = true;
        const status = response.status();
        mark(
          status >= 200 && status < 300
            ? 'password-headers-2xx'
            : status >= 400 && status < 500
              ? 'password-headers-4xx'
              : status >= 500 && status < 600
                ? 'password-headers-5xx'
                : 'password-headers-other',
        );
        return true;
      })
      .catch((error) => {
        if (active && error?.name === 'TimeoutError')
          mark(
            transportFailed
              ? 'password-ended-with-transport-failure'
              : first
                ? 'password-timeout-before-headers'
                : 'password-timeout-before-dispatch',
          );
        throw error;
      });
    mark('password-click-start');
    const [response] = await Promise.all([
      wait,
      click().then(
        () => {
          if (active) mark('password-click-complete');
        },
        (error) => {
          if (active) mark('password-click-failed');
          throw error;
        },
      ),
    ]);
    return response;
  } finally {
    active = false;
    page.off('request', dispatch);
    page.off('requestfailed', failed);
  }
}
export async function checkpoint({
  auth,
  email,
  password,
  actor,
  school,
  member,
  status,
  sql,
  ownership,
  bundle,
  mark,
}) {
  const origin = 'http://127.0.0.1:58329';
  // Prepare a verified synthetic authenticator only. No setup token crosses into Chromium.
  mark('factor-setup');
  const setup = await auth('POST', '/token?grant_type=password', { email, password });
  const factor = await auth(
    'POST',
    '/factors',
    { factor_type: 'totp', friendly_name: 'Synthetic checkpoint' },
    setup.access_token,
  );
  const challenge = await auth(
    'POST',
    '/factors/' + factor.id + '/challenge',
    {},
    setup.access_token,
  );
  const firstCode = currentTotp(factor.totp.secret);
  await auth(
    'POST',
    '/factors/' + factor.id + '/verify',
    { challenge_id: challenge.id, code: firstCode },
    setup.access_token,
  );
  const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const invoke = credentialOwnerHandler({
    supabaseUrl: status.API_URL,
    supabasePublishableKey: status.ANON_KEY,
    supabaseServiceRoleKey: status.SERVICE_ROLE_KEY,
    allowedOrigin: origin,
  });
  mark('schema-readiness');
  sql(
    `update public.organization_member_profiles set credential_applicability='trainee' where membership_id='${member}'; notify pgrst,'reload schema';`,
  );
  let ready = false;
  for (let i = 0; i < 20; i++) {
    const { error } = await service.rpc('credential_owner_submission', {
      p_actor: actor,
      p_session: randomUUID(),
      p_mfa: false,
      p_school: school,
      p_member: member,
      p_token_exp: Math.floor(Date.now() / 1000) + 60,
      p_action: 'status',
      p_version: null,
      p_details: null,
    });
    if (!error) {
      ready = true;
      break;
    }
    if (error.code !== 'PGRST202') break;
    await delay(250);
  }
  assert.ok(ready);
  mark('storage-setup');
  await withProofStorage(status, ownership, async () => {
    mark('approved-control');
    const prior = randomUUID(),
      key = school + '/' + member + '/' + prior + '.png';
    const { error } = await service.storage
      .from('credential-synthetic')
      .upload(key, Buffer.from(syntheticSample, 'base64'), {
        contentType: 'image/png',
        upsert: false,
      });
    assert.ok(!error);
    sql(`insert into credential_private.versions(id,organization_id,membership_id,category,state,license_type,license_number,issued_on,no_expiry,object_key,submitted_by,operation_id,evidence_sha256)
      values('${prior}','${school}','${member}','mother_license','approved','SPL','previous','2024-01-01',true,'${key}','${actor}',gen_random_uuid(),'b75368e414a64c223ffb18fef090a45ff203704613e11bdb922757ac5b00ee06')`);
    const approved = () =>
      sql(
        `select to_jsonb(v)::text from credential_private.versions v where id='${prior}' and state='approved'`,
      );
    const initial = approved();
    assert.ok(initial);
    async function login(page) {
      mark('browser-password');
      const mail = page.getByLabel('Email address');
      const pass = page.getByLabel('Password', { exact: true });
      const signIn = page.getByRole('button', { name: 'Sign in securely' });
      mark('password-fill-email');
      await mail.fill(email);
      mark('password-fill-password');
      await pass.fill(password);
      const signed = await observePasswordPost(page, status.API_URL, mark, () => signIn.click());
      mark('password-check-status');
      requireStatus(signed.status(), 200);
      mark('password-owner-identity');
      assert.ok((await signed.json()).user?.id === actor);
      mark('browser-password-passed');
      const input = page.getByLabel('Verification code');
      await input.waitFor();
      // Use a new full TOTP period after enrollment; never retry a rejected challenge.
      await delay(30100 - (Date.now() % 30000));
      const code = currentTotp(factor.totp.secret);
      assert.ok(code !== firstCode);
      await input.fill(code);
      mark('browser-totp');
      const metadata = page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          r.url() === status.API_URL + '/functions/v1/member-administration' &&
          r.request().postDataJSON()?.action === 'my_credentials',
      );
      // Observe the first metadata call even when it finishes before the page becomes idle.
      // Attach rejection handling immediately; a failed MFA remains the first failing boundary.
      void metadata.catch(() => {});
      const [verified] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.request().method() === 'POST' &&
            r.url() === status.API_URL + '/auth/v1/factors/' + factor.id + '/verify',
        ),
        page.getByRole('button', { name: 'Verify and continue' }).click(),
      ]);
      requireStatus(verified.status(), 200);
      mark('browser-totp-passed');
      mark('first-owner-metadata');
      const response = await metadata;
      requireStatus(response.status(), 200);
      mark('metadata-school-owner');
      assert.ok(authorizedMetadata(await response.json(), school, member));
      mark('first-owner-metadata-passed');
    }
    await proveOwnerBrowser({ status, school, member, origin, invoke, login, bundle, mark });
    mark('single-pending-version');
    assert.equal(
      sql("select count(*) from credential_private.versions where state='pending'"),
      '1',
    );
    mark('pending-owner-and-license');
    assert.equal(
      sql(
        `select count(*) from credential_private.versions where state='pending' and organization_id='${school}' and membership_id='${member}' and submitted_by='${actor}' and category='mother_license' and license_number='001-SYN'`,
      ),
      '1',
    );
    mark('approved-record-unchanged');
    assert.ok(approved() === initial);
    mark('private-preview-audit');
    assert.equal(
      sql(`select count(*) from credential_private.events e
        join credential_private.versions v on v.id=e.version_id and v.organization_id=e.organization_id
        join storage.buckets b on b.id='credential-synthetic' and not b.public
        where e.event='evidence_served' and e.actor_id='${actor}' and e.organization_id='${school}'
          and v.membership_id='${member}' and v.state='pending'`),
      '1',
    );
    mark('persisted-versions-passed');
  });
}
