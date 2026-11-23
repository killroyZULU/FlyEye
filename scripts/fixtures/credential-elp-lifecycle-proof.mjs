import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { syntheticSample } from '../../src/features/credentials/owner-gateway.ts';

export async function proveElp({ page, sql, school, member, actor, mark, origin, invoke, apiUrl }) {
  const snapshot = () =>
    JSON.parse(
      sql(`select jsonb_build_object(
    'versions',(select jsonb_agg(to_jsonb(v) order by id) from credential_private.versions v),
    'events',(select jsonb_agg(to_jsonb(e) order by id) from credential_private.events e),
    'objects',(select jsonb_agg(jsonb_build_array(id,name,metadata->>'size') order by id) from storage.objects where bucket_id='credential-synthetic'))::text`),
    );
  const click = async (action, name, status) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url() === apiUrl + '/functions/v1/credential-owner' &&
          r.request().method() === 'POST' &&
          r.request().postDataJSON()?.action === action,
      ),
      page.getByRole('button', { name, exact: true }).click(),
    ]);
    assert.equal(response.status(), status);
    return response;
  };
  async function fill(level, expires) {
    await page.getByLabel('ELP level').selectOption(level);
    await page.getByLabel('Issue date').fill('2020-02-01');
    if (expires) await page.getByLabel('Expiry date').fill(expires);
    else await page.getByLabel('No expiry').check();
    await page.getByLabel('Synthetic supporting PNG').setInputFiles({
      name: 'synthetic.png',
      mimeType: 'image/png',
      buffer: Buffer.from(syntheticSample, 'base64'),
    });
  }
  mark('elp-lifecycle-setup');
  const controls = snapshot();
  const mother = controls.versions.find(
    (v) => v.category === 'mother_license' && v.state === 'pending',
  );
  const approved = controls.versions.find((v) => v.category === 'elp' && v.state === 'approved');
  assert.ok(mother && approved && approved.expires_on === '2023-12-31');
  const scope = { organizationId: school, membershipId: member };
  await page.getByLabel('Credential category').selectOption('elp');
  await fill('5', '2025-01-01');
  const submitted = await click('submit', 'Submit ELP for review', 201);
  const prior = (await submitted.json()).id,
    form = submitted.request().postDataJSON();
  const auth = await submitted.request().headerValue('authorization');
  assert.ok(auth);
  const send = async (body, status) => {
    const response = await invoke(
      new Request(origin + '/functions/v1/credential-owner', {
        method: 'POST',
        headers: { Origin: origin, Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...scope, ...body }),
      }),
    );
    assert.equal(response.status, status);
    return response;
  };
  const replace = {
    ...form,
    action: 'replace',
    expectedPendingId: prior,
    operationId: randomUUID(),
    elpLevel: 6,
    expiryDate: null,
    noExpiry: true,
  };
  const withdraw = {
    action: 'withdraw',
    category: 'elp',
    operationId: randomUUID(),
    versionId: prior,
  };
  const before = snapshot();
  const original = before.versions.find((v) => v.id === prior);
  assert.ok(original && original.state === 'pending');
  mark('elp-lifecycle-denials');
  await send({ ...withdraw, versionId: mother.id }, 403);
  await send({ ...replace, expectedPendingId: mother.id }, 403);
  for (const command of [replace, withdraw]) {
    await send({ ...command, organizationId: randomUUID() }, 403);
    await send({ ...command, membershipId: randomUUID() }, 403);
  }
  assert.deepEqual(snapshot(), before);
  mark('elp-lifecycle-rollback');
  // Sequence advancement survives rollback and witnesses the exact failing audit insert.
  sql(`create sequence credential_private.elp_audit_attempt;
  create function credential_private.fail_elp_audit() returns trigger language plpgsql as $$begin
    perform nextval('credential_private.elp_audit_attempt'); raise exception 'fixture'; end;$$;`);
  for (const [command, event, attempt] of [
    [replace, 'submitted', 1],
    [withdraw, 'withdrawn', 2],
  ]) {
    sql(
      `create trigger fail_elp_audit before insert on credential_private.events for each row when(new.event='${event}') execute function credential_private.fail_elp_audit()`,
    );
    await send(command, 503);
    assert.equal(
      sql(`select is_called and last_value=${attempt} from credential_private.elp_audit_attempt`),
      't',
    );
    assert.deepEqual(snapshot(), before);
    sql('drop trigger fail_elp_audit on credential_private.events');
  }
  function assertEvents(previous, current, expected) {
    assert.deepEqual(
      current.events.filter((e) => previous.events.some((old) => old.id === e.id)),
      previous.events,
    );
    const delta = current.events.filter((e) => !previous.events.some((old) => old.id === e.id));
    assert.deepEqual(delta.map((e) => e.event + ':' + e.version_id).sort(), expected.sort());
    assert.ok(
      delta.every(
        (e) =>
          e.actor_id === actor &&
          e.organization_id === school &&
          Number.isFinite(Date.parse(e.occurred_at)),
      ),
    );
  }
  async function refresh(pendingId) {
    const response = await click('status', 'Refresh submissions', 200);
    const rows = (await response.json()).versions;
    assert.deepEqual(
      rows.filter((v) => v.category === 'elp' && v.state === 'pending').map((v) => v.id),
      pendingId ? [pendingId] : [],
    );
    assert.ok(rows.some((v) => v.id === mother.id && v.state === 'pending'));
    await page
      .getByText('Current approved — ELP Level 4 · 2020-01-01 · 2023-12-31', { exact: true })
      .waitFor();
    if (pendingId)
      await page
        .getByText('Pending — ELP Level 6 · 2020-02-01 · No expiry', { exact: true })
        .waitFor();
    else assert.equal(await page.getByText(/Pending — ELP/).count(), 0);
  }
  mark('elp-lifecycle-replace');
  await page.getByText(/Pending — ELP Level 5/).waitFor();
  await fill('6', null);
  const replaced = await click('replace', 'Replace pending ELP version', 201);
  const nextId = (await replaced.json()).id,
    replaceIntent = replaced.request().postDataJSON();
  assert.equal(replaceIntent.expectedPendingId, prior);
  await page.getByText('Pending version replaced.').waitFor();
  await refresh(nextId);
  const after = snapshot(),
    next = after.versions.find((v) => v.id === nextId);
  assert.deepEqual(
    after.versions.filter((v) => v.id !== nextId),
    before.versions.map((v) =>
      v.id === prior
        ? { ...v, state: 'withdrawn', withdrawal_operation_id: replaceIntent.operationId }
        : v,
    ),
  );
  assert.ok(
    next &&
      next.state === 'pending' &&
      next.category === 'elp' &&
      next.replaces_version_id === prior &&
      next.operation_id === replaceIntent.operationId &&
      next.elp_level === 6 &&
      next.no_expiry &&
      next.expires_on === null &&
      next.membership_id === member &&
      next.submitted_by === actor &&
      next.organization_id === school,
  );
  assertEvents(before, after, ['submitted:' + nextId, 'withdrawn:' + prior]);
  assert.deepEqual(
    after.objects.filter(([, key]) => key !== next.object_key),
    before.objects,
  );
  assert.ok(after.objects.some(([, key, size]) => key === next.object_key && size === '69'));
  assert.equal((await (await send(replaceIntent, 200)).json()).id, nextId);
  await send({ ...replaceIntent, elpLevel: 4 }, 409);
  await send({ ...replaceIntent, operationId: randomUUID() }, 409);
  await send(withdraw, 409);
  assert.deepEqual(snapshot(), after);
  mark('elp-lifecycle-withdraw');
  const removed = await click('withdraw', 'Withdraw pending submission', 200);
  const withdrawIntent = removed.request().postDataJSON();
  assert.equal(withdrawIntent.category, 'elp');
  assert.equal(withdrawIntent.versionId, nextId);
  await page.getByText('Submission withdrawn.').waitFor();
  await refresh(null);
  const final = snapshot();
  assert.deepEqual(
    final.versions,
    after.versions.map((v) =>
      v.id === nextId
        ? { ...v, state: 'withdrawn', withdrawal_operation_id: withdrawIntent.operationId }
        : v,
    ),
  );
  assertEvents(after, final, ['withdrawn:' + nextId]);
  assert.deepEqual(final.objects, after.objects);
  for (const action of ['withdraw', 'withdraw_outcome'])
    assert.equal((await (await send({ ...withdrawIntent, action }, 200)).json()).id, nextId);
  await send({ ...withdrawIntent, versionId: prior }, 409);
  await send({ ...withdrawIntent, operationId: randomUUID() }, 409);
  assert.equal((await (await send(replaceIntent, 200)).json()).id, nextId);
  assert.deepEqual(snapshot(), final);
  mark('elp-lifecycle-retention');
  for (const row of [original, next]) {
    await send({ action: 'evidence', versionId: row.id, membershipId: randomUUID() }, 403);
    const file = await send({ action: 'evidence', versionId: row.id }, 200);
    assert.match(file.headers.get('cache-control'), /private, no-store/);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await file.arrayBuffer()))
        .digest('hex'),
      row.evidence_sha256,
    );
  }
  const end = snapshot();
  assertEvents(final, end, ['evidence_served:' + prior, 'evidence_served:' + nextId]);
  assert.deepEqual(end.objects, final.objects);
  assert.deepEqual(end.versions, final.versions);
  await page.getByLabel('Credential category').selectOption('mother_license');
  await page.getByText(/Pending — PPL 001-SYN/).waitFor();
}
