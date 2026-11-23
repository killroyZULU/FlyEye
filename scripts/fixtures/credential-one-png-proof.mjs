import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

// Called only inside the existing owned Storage fixture, after seeding its approved control.
export async function proveOnePng({
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
  const digest = createHash('sha256').update(Buffer.from(submit.file, 'base64')).digest('hex');
  const state = () =>
    sql(`select jsonb_build_object(
    'versions',(select jsonb_agg(to_jsonb(v) order by id) from credential_private.versions v),
    'objects',(select jsonb_agg(jsonb_build_array(id,name,metadata->>'size') order by id) from storage.objects where bucket_id='credential-synthetic'),
    'events',(select jsonb_agg(to_jsonb(e) order by id) from credential_private.events e))::text`);
  const reconcile = { action: 'reconcile', operationId: submit.operationId };
  async function deny(token, action, status) {
    const reply = await request(token, action);
    assert.equal(reply.status, status);
    assert.equal(reply.headers.has('Content-Disposition'), false);
    assert.deepEqual(await reply.json(), null);
  }
  mark('png-lost-response');
  const before = await request(aal2, reconcile);
  assert.equal(before.status, 200);
  assert.equal((await before.json()).state, 'unconfirmed');
  await request(aal2, submit); // Discard the acknowledgement. Recover only from the journalled operation key.
  const committed = state();
  const pending =
    sql(`select id from credential_private.versions where organization_id='${school}' and membership_id='${member}'
    and operation_id='${submit.operationId}' and submitted_by='${actor}' and state='pending' and category='mother_license' and evidence_sha256='${digest}'`);
  assert.match(pending, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  const rows = JSON.parse(committed);
  assert.equal(rows.versions.length, 2);
  assert.equal(rows.objects.length, 2);
  assert.equal(rows.events.length, 1);
  assert.equal(rows.events[0].event, 'submitted');
  assert.equal(rows.events[0].version_id, pending);
  assert.equal(rows.events[0].actor_id, actor);
  assert.equal(rows.events[0].organization_id, school);
  assert.ok(
    rows.objects.some(
      ([, key, size]) => key === school + '/' + member + '/' + pending + '.png' && size === '69',
    ),
  );
  const outcome = await request(aal2, reconcile);
  assert.equal(outcome.status, 200);
  const result = await outcome.json();
  assert.equal(result.id, pending);
  assert.equal(result.state, 'pending');
  assert.equal(state(), committed);
  mark('png-replay-and-conflict');
  const replay = await request(aal2, submit);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { id: pending, state: 'pending' });
  for (const patch of [{ licenseNumber: 'DIFFERENT' }, { operationId: randomUUID() }]) {
    await deny(aal2, { ...submit, ...patch }, 409);
  }
  assert.equal(state(), committed);
  mark('png-evidence-control');
  const evidence = { action: 'evidence', versionId: pending };
  const positive = await request(aal2, evidence);
  assert.equal(positive.status, 200);
  assert.equal(
    createHash('sha256')
      .update(Buffer.from(await positive.arrayBuffer()))
      .digest('hex'),
    digest,
  );
  const stable = state();
  assert.equal(
    JSON.parse(stable).events.filter(
      (e) =>
        e.event === 'evidence_served' &&
        e.version_id === pending &&
        e.actor_id === actor &&
        e.organization_id === school,
    ).length,
    1,
  );
  mark('png-evidence-denied');
  await deny(aal1, evidence, 403);
  await deny(aal2, { ...evidence, membershipId: randomUUID() }, 403);
  await deny(aal2, { ...evidence, organizationId: randomUUID() }, 403);
  assert.equal(state(), stable);
  mark('png-evidence-audit-failure');
  sql(`begin;
    create function credential_private.fail_png_serve() returns trigger language plpgsql as $f$begin raise exception 'fixture'; end;$f$;
    create trigger block_png_serve before insert on credential_private.events for each row when(new.event='evidence_served') execute function credential_private.fail_png_serve();
    commit;`);
  await deny(aal2, evidence, 503);
  assert.equal(state(), stable);
  sql(
    'drop trigger block_png_serve on credential_private.events; drop function credential_private.fail_png_serve()',
  );
  for (const [label, times] of [
    [
      'png-idle-expiry',
      "started_at=clock_timestamp()-interval '1 hour',active_at=clock_timestamp()-interval '45 minutes'",
    ],
    [
      'png-absolute-expiry',
      "started_at=clock_timestamp()-interval '12 hours',active_at=clock_timestamp()",
    ],
  ]) {
    mark(label);
    assert.equal(
      sql(
        `with changed as (update credential_private.session_windows set ${times} where session_id='${sid}' and user_id='${actor}' returning 1) select count(*) from changed`,
      ),
      '1',
    );
    await deny(aal2, { ...submit, operationId: randomUUID() }, 403);
    await deny(aal2, evidence, 403);
    await deny(aal2, reconcile, 403);
    assert.equal(state(), stable);
  }
  assert.equal(priorRow(), original);
  mark('png-invariants-passed');
}
