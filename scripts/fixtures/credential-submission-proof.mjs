import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { credentialOwnerHandler } from '../../supabase/functions/credential-owner/handler.ts';
import { withProofStorage } from './credential-proof-storage.mjs';
import { syntheticSample } from '../../src/features/credentials/owner-gateway.ts';

export async function proveSubmission({
  bundle,
  mark,
  ownership,
  status,
  sql,
  school,
  member,
  actor,
  sid,
  aal1,
  aal2,
  session,
}) {
  const origin = 'http://127.0.0.1:58329';
  const invoke = credentialOwnerHandler({
    supabaseUrl: status.API_URL,
    supabaseServiceRoleKey: status.SERVICE_ROLE_KEY,
    supabasePublishableKey: status.ANON_KEY,
    allowedOrigin: origin,
  });
  const request = (token, body) =>
    invoke(
      new Request(origin + '/functions/v1/credential-owner', {
        method: 'POST',
        headers: {
          Origin: origin,
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ organizationId: school, membershipId: member, ...body }),
      }),
    );
  const submit = {
    action: 'submit',
    operationId: randomUUID(),
    licenseType: 'PPL',
    licenseNumber: '001-SYN',
    issueDate: '2025-01-01',
    expiryDate: null,
    noExpiry: true,
    filename: 'proof.png',
    mime: 'image/png',
    file: syntheticSample,
  };
  let step = 'rpc-readiness';
  try {
    sql(
      `update public.organization_member_profiles set credential_applicability='trainee' where membership_id='${member}'; notify pgrst,'reload schema';`,
    );
    const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let ready = false;
    for (let i = 0; i < 15; i++) {
      const { error } = await service.rpc('credential_owner_submission', {
        p_actor: actor,
        p_session: sid,
        p_mfa: true,
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
      await delay(250);
    }
    assert.ok(ready);
    await withProofStorage(status, ownership, async () => {
      step = 'approved-control';
      const prior = randomUUID(),
        priorKey = school + '/' + member + '/' + prior + '.png';
      const bucket = service.storage.from('credential-synthetic');
      const upload = await bucket.upload(priorKey, Buffer.from(syntheticSample, 'base64'), {
        contentType: 'image/png',
        upsert: false,
      });
      assert.ok(!upload.error);
      sql(`insert into credential_private.versions(id,organization_id,membership_id,category,state,license_type,license_number,issued_on,no_expiry,object_key,submitted_by,operation_id,evidence_sha256)
        values('${prior}','${school}','${member}','mother_license','approved','SPL','previous','2024-01-01',true,'${priorKey}','${actor}',gen_random_uuid(),'b75368e414a64c223ffb18fef090a45ff203704613e11bdb922757ac5b00ee06')`);
      const priorRow = () =>
        sql(`select to_jsonb(v)::text from credential_private.versions v where id='${prior}'`);
      const original = priorRow();
      step = 'validation-and-denials';
      assert.equal((await request(aal1, submit)).status, 403);
      assert.equal((await request(aal2, { ...submit, organizationId: randomUUID() })).status, 403);
      assert.equal((await request(aal2, { ...submit, membershipId: randomUUID() })).status, 403);
      assert.equal(
        (await request(aal2, { ...submit, file: syntheticSample.slice(4) })).status,
        400,
      );
      assert.equal((await request(aal2, { ...submit, issueDate: '2099-01-01' })).status, 400);
      assert.equal(
        sql("select count(*) from storage.objects where bucket_id='credential-synthetic'"),
        '1',
      );
      assert.equal((await request(aal2, { ...submit, licenseNumber: '\t001-SYN' })).status, 400);
      step = 'guard-outage';
      sql(
        "create function credential_private.fail_guard() returns trigger language plpgsql as $trigger$begin raise exception 'fixture'; end;$trigger$; create trigger guard_outage before insert or update on credential_private.request_limits for each row execute function credential_private.fail_guard()",
      );
      assert.equal((await request(aal2, submit)).status, 503);
      assert.equal(
        sql("select count(*) from storage.objects where bucket_id='credential-synthetic'"),
        '1',
      );
      sql('drop trigger guard_outage on credential_private.request_limits');
      step = 'audit-rollback';
      sql(
        "create function credential_private.fail_proof_event() returns trigger language plpgsql as $$begin raise exception 'fixture'; end;$$; create trigger reject_fixture before insert on credential_private.events for each row execute function credential_private.fail_proof_event()",
      );
      assert.equal((await request(aal2, submit)).status, 503);
      assert.equal(
        sql("select count(*) from credential_private.versions where state='pending'"),
        '0',
      );
      assert.equal(sql('select count(*) from credential_private.events'), '0');
      const orphan = sql(
        `select name from storage.objects where bucket_id='credential-synthetic' and name<>'${priorKey}'`,
      );
      assert.match(orphan, /^[a-f0-9/-]+\.png$/);
      const orphanId = orphan.split('/').at(-1).slice(0, -4);
      assert.equal((await request(aal2, { action: 'evidence', versionId: orphanId })).status, 403);
      const ordinary = createClient(status.API_URL, status.ANON_KEY, {
        global: { headers: { Authorization: 'Bearer ' + aal2 } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      assert.ok((await ordinary.storage.from('credential-synthetic').download(orphan)).error);
      assert.ok(
        (await ordinary.storage.from('credential-synthetic').createSignedUrl(orphan, 60)).error,
      );
      sql('drop trigger reject_fixture on credential_private.events');
      console.log(
        'Submission proof passed: validation, scope, MFA, failed audit rollback and private orphan denial.',
      );
      step = 'browser';
      const { proveOwnerBrowser } = await import('./credential-owner-browser.mjs');
      const operationId = await proveOwnerBrowser({
        bundle,
        mark,
        status,
        school,
        member,
        origin,
        invoke,
        session,
      });
      const pending = sql("select id from credential_private.versions where state='pending'");
      assert.match(pending, /^[a-f0-9-]{36}$/);
      step = 'duplicate-and-current';
      assert.equal((await request(aal2, submit)).status, 409);
      const replay = await request(aal2, { ...submit, operationId });
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).id, pending);
      assert.equal(
        (await request(aal2, { ...submit, operationId, licenseNumber: 'DIFFERENT' })).status,
        409,
      );
      assert.equal(
        sql("select count(*) from credential_private.events where event='submitted'"),
        '1',
      );
      assert.equal(
        sql("select count(*) from credential_private.events where event='evidence_served'"),
        '1',
      );
      assert.equal(
        sql("select evidence_sha256 from credential_private.versions where state='pending'"),
        'b75368e414a64c223ffb18fef090a45ff203704613e11bdb922757ac5b00ee06',
      );
      assert.equal(
        sql("select count(*) from credential_private.versions where state='pending'"),
        '1',
      );
      assert.equal(priorRow(), original);
      step = 'file-access';
      const evidence = { action: 'evidence', versionId: pending };
      sql(
        "create trigger block_evidence_audit before insert on credential_private.events for each row when(new.event='evidence_served') execute function credential_private.fail_proof_event()",
      );
      const blocked = await request(aal2, evidence);
      assert.equal(blocked.status, 503);
      assert.equal(await blocked.json(), null);
      assert.equal(
        sql("select count(*) from credential_private.events where event='evidence_served'"),
        '1',
      );
      sql('drop trigger block_evidence_audit on credential_private.events');
      assert.equal((await request(aal1, evidence)).status, 403);
      assert.equal((await request(aal2, { ...evidence, membershipId: randomUUID() })).status, 403);
      assert.equal(
        (await request(aal2, { ...evidence, organizationId: randomUUID() })).status,
        403,
      );
      assert.ok(
        Number(
          sql("select count(*) from credential_private.security_events where outcome='denied'"),
        ) > 0,
      );
      // Put this actor's bucket at the boundary without generating a burst of requests.
      sql(
        `update credential_private.request_limits set hits=12,since=clock_timestamp() where actor_id='${actor}' and action='submit'`,
      );
      const limited = await request(aal2, submit);
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get('retry-after'), '60');
      sql(
        `update credential_private.request_limits set since=clock_timestamp()-interval '2 minutes' where actor_id='${actor}' and action='submit'`,
      );
      for (const clock of [
        "active_at=clock_timestamp()-interval '45 minutes'",
        "active_at=clock_timestamp(),started_at=clock_timestamp()-interval '12 hours'",
      ]) {
        sql(`update credential_private.session_windows set ${clock} where session_id='${sid}'`);
        assert.equal((await request(aal2, submit)).status, 403);
        assert.equal((await request(aal2, evidence)).status, 403);
        assert.equal((await request(aal2, { action: 'reconcile', operationId })).status, 403);
      }
      assert.equal(priorRow(), original);
      console.log(
        'Submission proof passed: one pending, one audit, approved version unchanged; idle and absolute expiry deny reads and writes.',
      );
    });
  } catch (error) {
    mark(
      'failure-' +
        step +
        (error?.name === 'TimeoutError'
          ? '-timeout'
          : error?.code === 'ERR_ASSERTION'
            ? '-assertion'
            : '-operation'),
    );
    console.error(
      'Submission proof stopped at ' +
        step +
        ' (' +
        (error?.code === 'ERR_ASSERTION' ? 'assertion' : 'operation') +
        ').',
    );
    throw new Error('Submission proof incomplete.', { cause: error });
  }
}
