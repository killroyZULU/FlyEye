import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

// Runs only in the ownership-checked, disposable synthetic checkpoint.
export async function proveWithdrawal({
  request,
  submit,
  sql,
  mark,
  priorRow,
  original,
  school,
  member,
  actor,
  sid,
  aal1,
  aal2,
}) {
  const approved = JSON.parse(original).id;
  sql(
    `update credential_private.versions set expires_on='2028-12-31',no_expiry=false where id='${approved}' and state='approved'`,
  );
  const approval = priorRow();
  assert.equal(JSON.parse(approval).expires_on, '2028-12-31');
  async function send(token, body, expected) {
    const response = await request(token, body);
    assert.equal(response.status, expected);
    const data = await response.json();
    if (expected >= 400) assert.equal(data, null);
    return data;
  }
  const pending = (await send(aal2, submit, 201)).id;
  assert.match(pending, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  const command = { action: 'withdraw', versionId: pending, operationId: randomUUID() };
  const outcome = { ...command, action: 'withdraw_outcome' };
  const snapshot = () =>
    JSON.parse(
      sql(`select jsonb_build_object(
    'versions',(select jsonb_agg(to_jsonb(v) order by id) from credential_private.versions v),
    'objects',(select jsonb_agg(to_jsonb(o) order by id) from storage.objects o where bucket_id='credential-synthetic'),
    'events',(select jsonb_agg(to_jsonb(e) order by id) from credential_private.events e))::text`),
    );
  const before = snapshot();
  assert.equal(before.versions.length, 2);
  assert.equal(before.objects.length, 2);
  assert.equal(before.events.length, 1);
  mark('withdrawal-authorization');
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
            target::text,owner_id,gen_random_uuid(),evidence_sha256 from credential_private.versions where id='${pending}';
        result:=public.credential_owner_submission('${actor}','${sid}',true,'${school}',extract(epoch from now())::bigint+60,
          '${member}','withdraw',target,jsonb_build_object('operationId',gen_random_uuid()));
        if result is not null or not exists(select from credential_private.versions where id=target and state='pending')
          or exists(select from credential_private.events where version_id=target) then raise exception 'foreign target'; end if;
      end loop;
    end; $proof$; rollback;`);
  assert.deepEqual(await send(aal2, outcome, 200), { id: pending, state: 'unconfirmed' });
  await send(aal1, command, 403);
  await send(aal2, { ...command, membershipId: randomUUID() }, 403);
  await send(aal2, { ...command, organizationId: randomUUID() }, 403);
  await send(aal2, { ...command, versionId: approved }, 409);
  assert.deepEqual(snapshot(), before);
  mark('withdrawal-audit-rollback');
  sql(`create function credential_private.fail_withdrawal_event() returns trigger language plpgsql as $$begin raise exception 'fixture'; end;$$;
    create trigger reject_withdrawal before insert on credential_private.events for each row when(new.event='withdrawn') execute function credential_private.fail_withdrawal_event()`);
  await send(aal2, command, 503);
  assert.deepEqual(snapshot(), before);
  sql('drop trigger reject_withdrawal on credential_private.events');
  mark('withdrawal-commit');
  const confirmed = { id: pending, state: 'withdrawn' };
  assert.deepEqual(await send(aal2, command, 200), confirmed);
  const after = snapshot();
  assert.deepEqual(after.objects, before.objects);
  assert.deepEqual(
    after.versions,
    before.versions.map((v) =>
      v.id === pending
        ? { ...v, state: 'withdrawn', withdrawal_operation_id: command.operationId }
        : v,
    ),
  );
  assert.deepEqual(
    after.events.filter((e) => e.event !== 'withdrawn'),
    before.events,
  );
  const events = after.events.filter((e) => e.event === 'withdrawn');
  assert.equal(events.length, 1);
  assert.equal(events[0].organization_id, school);
  assert.equal(events[0].version_id, pending);
  assert.equal(events[0].actor_id, actor);
  assert.ok(Number.isFinite(Date.parse(events[0].occurred_at)));
  const status = await send(aal2, { action: 'status' }, 200);
  assert.deepEqual(
    status.versions.map((v) => [v.id, v.state, v.expiryDate]),
    [[approved, 'approved', '2028-12-31']],
  );
  assert.deepEqual(await send(aal2, submit, 200), { id: pending, state: 'pending' });
  const submissionOutcome = await send(
    aal2,
    { action: 'reconcile', operationId: submit.operationId },
    200,
  );
  assert.equal(submissionOutcome.id, pending);
  assert.equal(submissionOutcome.state, 'withdrawn');
  assert.deepEqual(snapshot(), after);
  mark('withdrawal-retention');
  const file = await request(aal2, { action: 'evidence', versionId: pending });
  assert.equal(file.status, 200);
  assert.equal(
    createHash('sha256')
      .update(Buffer.from(await file.arrayBuffer()))
      .digest('hex'),
    before.versions.find((v) => v.id === pending).evidence_sha256,
  );
  mark('withdrawal-stale-replay');
  const newer = (await send(aal2, { ...submit, operationId: randomUUID() }, 201)).id;
  const stable = snapshot();
  assert.ok(stable.versions.some((v) => v.id === newer && v.state === 'pending'));
  assert.deepEqual(await send(aal2, outcome, 200), confirmed);
  assert.deepEqual(await send(aal2, command, 200), confirmed);
  await send(aal2, { ...command, operationId: randomUUID() }, 409);
  await send(aal2, { ...command, versionId: newer }, 409);
  sql(
    `update public.organization_memberships set status='suspended' where organization_id='${school}' and id='${member}'`,
  );
  await send(aal2, outcome, 403);
  sql(
    `update public.organization_memberships set status='active' where organization_id='${school}' and id='${member}'`,
  );
  mark('withdrawal-session-expiry');
  for (const dates of [
    "started_at=clock_timestamp()-interval '1 hour', active_at=clock_timestamp()-interval '45 minutes'",
    "started_at=clock_timestamp()-interval '12 hours', active_at=clock_timestamp()",
  ]) {
    sql(
      `update credential_private.session_windows set ${dates} where user_id='${actor}' and session_id='${sid}'`,
    );
    await send(aal2, { action: 'withdraw', operationId: randomUUID(), versionId: newer }, 403);
    await send(aal2, outcome, 403);
  }
  assert.deepEqual(snapshot(), stable);
  assert.equal(priorRow(), approval);
  mark('withdrawal-invariants-passed');
}
