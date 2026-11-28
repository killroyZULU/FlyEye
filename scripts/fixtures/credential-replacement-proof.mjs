import assert from 'node:assert/strict';
import { raceReplacementCommits } from './credential-replacement-race.mjs';
import { passwordActor } from '../../supabase/functions/credential-owner/handler.ts';
import { createHash, randomUUID } from 'node:crypto';
import { syntheticSample } from '../../src/features/credentials/owner-gateway.ts';

// The disposable browser adapter keeps its one synthetic request in memory.
// Only fixed checkpoint labels leave the runner.
export function replacementProof({ invoke, origin, apiUrl, sql, school, member, actor, mark }) {
  let intent, authorization;
  const snapshot = () =>
    JSON.parse(
      sql(`select jsonb_build_object(
    'versions',(select jsonb_agg(to_jsonb(v) order by id) from credential_private.versions v),
    'events',(select jsonb_agg(to_jsonb(e) order by id) from credential_private.events e),
    'objects',(select jsonb_agg(jsonb_build_array(id,name,metadata->>'size') order by id) from storage.objects where bucket_id='credential-synthetic'))::text`),
    );
  const request = (body) =>
    invoke(
      new Request(origin + '/functions/v1/credential-owner', {
        method: 'POST',
        headers: {
          Origin: origin,
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ organizationId: school, membershipId: member, ...body }),
      }),
    );
  async function send(body, status) {
    const result = await request(body);
    assert.equal(result.status, status);
    return await result.json();
  }
  return {
    dropAcknowledgement(body, request, result) {
      if (intent || body.action !== 'replace' || result.status !== 201) return false;
      intent = body;
      authorization = request.headers.get('Authorization');
      return true;
    },
    async run(page) {
      mark('replacement-browser');
      const before = snapshot();
      const prior = before.versions.find((v) => v.state === 'pending');
      const approved = before.versions.find((v) => v.state === 'approved');
      assert.equal(approved.expires_on, '2028-12-31');
      await page.getByLabel('License type').selectOption('CPL');
      await page.getByLabel('License number').fill('002-REPLACEMENT');
      await page.getByLabel('Issue date').fill('2025-02-01');
      await page.getByLabel('No expiry').check();
      await page.getByLabel('Supporting evidence (one PDF or one or two images)').setInputFiles({
        name: 'sample.png',
        mimeType: 'image/png',
        buffer: Buffer.from(syntheticSample, 'base64'),
      });
      const [lost] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.request().method() === 'POST' &&
            r.url().endsWith('/functions/v1/credential-owner') &&
            r.request().postDataJSON()?.action === 'replace',
        ),
        page.getByRole('button', { name: 'Replace pending version' }).click(),
      ]);
      assert.equal(lost.status(), 503);
      assert.equal(intent.expectedPendingId, prior.id);
      assert.ok(authorization);
      mark('replacement-readback');
      const committed = snapshot();
      await page.getByRole('button', { name: 'Check replacement outcome' }).click();
      await page.getByText('Replacement confirmed.').waitFor();
      await page.getByText(/Pending — CPL 002-REPLACEMENT/).waitFor();
      await page.getByText(/Current approved — SPL previous/).waitFor();
      assert.equal(await page.getByText(/Pending — PPL 001-SYN/).count(), 0);
      assert.deepEqual(snapshot(), committed);
      const active = committed.versions.filter((v) => v.state === 'pending');
      assert.equal(active.length, 1);
      const [next] = active;
      assert.equal(committed.versions.length, before.versions.length + 1);
      assert.equal(next.replaces_version_id, prior.id);
      assert.equal(next.operation_id, intent.operationId);
      assert.equal(next.submitted_by, actor);
      assert.deepEqual(
        committed.versions.find((v) => v.id === prior.id),
        { ...prior, state: 'withdrawn', withdrawal_operation_id: intent.operationId },
      );
      assert.deepEqual(
        committed.versions.find((v) => v.id === approved.id),
        approved,
      );
      const history = committed.events.filter((e) => !before.events.some((old) => old.id === e.id));
      assert.equal(history.length, 2);
      assert.ok(
        history.every(
          (e) =>
            e.actor_id === actor &&
            e.organization_id === school &&
            Number.isFinite(Date.parse(e.occurred_at)),
        ),
      );
      assert.ok(history.some((e) => e.version_id === prior.id && e.event === 'withdrawn'));
      assert.ok(history.some((e) => e.version_id === next.id && e.event === 'submitted'));
      mark('replacement-history');
      for (const version of [prior, next]) {
        const evidence = await request({ action: 'evidence', versionId: version.id });
        assert.equal(evidence.status, 200);
        assert.equal(
          createHash('sha256')
            .update(Buffer.from(await evidence.arrayBuffer()))
            .digest('hex'),
          version.evidence_sha256,
        );
      }
      mark('replacement-replay');
      const sessionId = passwordActor(authorization.slice('Bearer '.length), actor)?.p_session;
      assert.match(sessionId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
      assert.equal(
        sql(`select public.credential_owner_submission('${actor}','${sessionId}',true,'${school}',
        extract(epoch from now())::bigint+60,'${member}','prepare',gen_random_uuid(),
        jsonb_build_object('operationId',gen_random_uuid(),'expectedPendingId','${next.id}')) ? 'key'`),
        't',
      );
      // Exercise known foreign targets inside a rollback-only transaction. The deployed
      // single-school constraint stays intact outside this synthetic comparison.
      sql(`begin;
    set constraints organizations_single_school_deployment_key deferred;
    do $proof$
    declare other_school uuid:=gen_random_uuid(); org uuid; owner_id uuid; member_id uuid; target uuid; result jsonb;
    begin
      insert into public.organizations(id,name) values(other_school,'Synthetic second school');
      foreach org in array array['${school}'::uuid,other_school] loop
        owner_id:=gen_random_uuid(); member_id:=gen_random_uuid(); target:=gen_random_uuid();
        insert into auth.users(id) values(owner_id);
        insert into public.organization_memberships(id,organization_id,user_id) values(member_id,org,owner_id);
        insert into credential_private.versions(id,organization_id,membership_id,category,state,license_type,license_number,
          issued_on,no_expiry,object_key,submitted_by,operation_id,evidence_sha256)
          select target,org,member_id,category,'pending',license_type,license_number,issued_on,true,
            target::text,owner_id,gen_random_uuid(),evidence_sha256 from credential_private.versions where id='${next.id}';
        result:=public.credential_owner_submission('${actor}','${sessionId}',true,'${school}',extract(epoch from now())::bigint+60,
          '${member}','prepare',gen_random_uuid(),jsonb_build_object('operationId',gen_random_uuid(),'expectedPendingId',target));
        if result is not null or not exists(select from credential_private.versions where id=target and state='pending')
          or exists(select from credential_private.events where version_id=target) then raise exception 'foreign target'; end if;
      end loop;
    end; $proof$; rollback;`);

      const stable = snapshot();
      assert.deepEqual(await send(intent, 200), { id: next.id, state: 'pending' });
      for (const changes of [
        { operationId: randomUUID() },
        { licenseNumber: 'Different' },
        { expectedPendingId: next.id },
      ])
        assert.equal(await send({ ...intent, ...changes }, 409), null);
      for (const changes of [{ organizationId: randomUUID() }, { membershipId: randomUUID() }])
        assert.equal(
          await send(
            { ...intent, expectedPendingId: next.id, operationId: randomUUID(), ...changes },
            403,
          ),
          null,
        );
      assert.deepEqual(snapshot(), stable);
      mark('replacement-race');
      const command = { ...intent, expectedPendingId: next.id };
      const raced = await raceReplacementCommits({
        apiUrl,
        command,
        request,
        assertPrepared(ids) {
          const prepared = snapshot();
          assert.deepEqual(prepared.versions, stable.versions);
          assert.deepEqual(prepared.events, stable.events);
          const newKeys = prepared.objects
            .filter((o) => !stable.objects.some((old) => old[0] === o[0]))
            .map((o) => o[1])
            .sort();
          assert.deepEqual(
            newKeys,
            ids.map((id) => school + '/' + member + '/' + id + '.png').sort(),
          );
        },
      });
      assert.deepEqual(raced.map((r) => r.response.status).sort(), [201, 409]);
      const success = raced.find((r) => r.response.status === 201),
        loser = raced.find((r) => r.response.status === 409);
      const winner = (await success.response.json()).id;
      assert.equal(winner, success.versionId);
      const won = snapshot();
      assert.ok(
        won.versions.some((v) => v.id === winner && v.operation_id === success.operationId),
      );
      assert.ok(
        !won.objects.some((o) => o[1] === school + '/' + member + '/' + loser.versionId + '.png'),
      );
      assert.ok(!won.events.some((e) => e.version_id === loser.versionId));
      assert.equal(won.versions.length, stable.versions.length + 1);
      assert.equal(won.events.length, stable.events.length + 2);
      assert.equal(won.objects.length, stable.objects.length + 1);
      assert.deepEqual(
        won.versions.filter((v) => v.state === 'pending').map((v) => [v.id, v.replaces_version_id]),
        [[winner, next.id]],
      );
      mark('replacement-audit-rollback');
      sql(`create sequence credential_private.replacement_audit_attempt;
      create function credential_private.fail_replacement_audit() returns trigger language plpgsql as $$begin
        perform nextval('credential_private.replacement_audit_attempt'); raise exception 'fixture'; end;$$;
      create trigger fail_replacement before insert on credential_private.events for each row when(new.event='submitted') execute function credential_private.fail_replacement_audit()`);
      const failed = { ...intent, expectedPendingId: winner, operationId: randomUUID() };
      assert.equal(await send(failed, 503), null);
      // Sequence advancement survives transaction rollback and witnesses the exact injected failure.
      assert.equal(
        sql('select is_called and last_value=1 from credential_private.replacement_audit_attempt'),
        't',
      );
      assert.deepEqual(snapshot(), won);
      assert.equal(
        (
          await send(
            { action: 'reconcile', operationId: failed.operationId, expectedPendingId: winner },
            200,
          )
        ).state,
        'unconfirmed',
      );
      assert.deepEqual(snapshot(), won);
    },
  };
}
