import { proveForeignDeclarationDenied } from './credential-declaration-scope.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { syntheticSample } from '../../src/features/credentials/owner-gateway.ts';
import { passwordActor } from '../../supabase/functions/credential-owner/handler.ts';

export async function proveElp({
  page,
  sql,
  school,
  member,
  actor,
  mark,
  origin,
  invoke,
  apiUrl,
  seedApprovedElp,
}) {
  const snapshot = () =>
    JSON.parse(
      sql(`select jsonb_build_object(
    'versions',(select jsonb_agg(to_jsonb(v) order by id) from credential_private.versions v),
    'events',(select jsonb_agg(to_jsonb(e) order by id) from credential_private.events e),
    'objects',(select jsonb_agg(jsonb_build_array(id,name,metadata) order by id) from storage.objects where bucket_id='credential-synthetic'),
    'declarations',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from credential_private.declarations d))::text`),
    );
  const responseFor = (action) =>
    page.waitForResponse(
      (r) =>
        r.url() === apiUrl + '/functions/v1/credential-owner' &&
        r.request().method() === 'POST' &&
        r.request().postDataJSON()?.action === action,
    );
  const click = async (name, action, status) => {
    const [response] = await Promise.all([
      responseFor(action),
      page.getByRole('button', { name, exact: true }).click(),
    ]);
    assert.equal(response.status(), status);
    return response;
  };
  const declareButton = 'Declare ELP not yet obtained',
    declaredLabel = 'ELP — Not yet obtained',
    requiredLabel = 'ELP required — no approved credential on file.';
  const refresh = async (state) => {
    const response = await click('Refresh submissions', 'status', 200);
    const data = await response.json();
    assert.equal(data.elpCompleteness, state);
    return data.versions;
  };
  const applicability = (value) =>
    sql(
      `update public.organization_member_profiles set credential_applicability='${value}' where organization_id='${school}' and membership_id='${member}'`,
    );
  await page.getByLabel('Credential category').selectOption('elp');
  await page.getByRole('button', { name: declareButton }).waitFor();
  const meta = await click('Refresh submissions', 'status', 200);
  assert.equal((await meta.json()).elpCompleteness, 'undeclared');
  const authorization = await meta.request().headerValue('authorization');
  assert.ok(authorization);
  const body = {
    action: 'declare_elp',
    organizationId: school,
    membershipId: member,
    operationId: randomUUID(),
  };
  const send = async (patch, status) => {
    const response = await invoke(
      new Request(origin + '/functions/v1/credential-owner', {
        method: 'POST',
        headers: {
          Origin: origin,
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...body, ...patch }),
      }),
    );
    assert.equal(response.status, status);
  };
  const before = snapshot();
  assert.deepEqual(before.declarations, []);
  assert.equal(
    before.versions.some((v) => v.category === 'elp'),
    false,
  );
  mark('elp-declaration-eligibility');
  for (const patch of [{ organizationId: randomUUID() }, { membershipId: randomUUID() }])
    await send(patch, 403);
  const session = passwordActor(authorization.slice('Bearer '.length), actor)?.p_session;
  assert.match(session, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  proveForeignDeclarationDenied(sql, school, actor, session, 'declare_elp');
  // Exercise the database assurance and expired-token boundaries independently of the handler.
  for (const [mfa, exp] of [
    ['false', 'extract(epoch from now())::bigint+60'],
    ['true', '0'],
  ]) {
    assert.equal(
      sql(
        `select public.credential_owner_submission('${actor}','${session}',${mfa},'${school}',${exp},'${member}','declare_elp',null,jsonb_build_object('operationId',gen_random_uuid())) is null`,
      ),
      't',
    );
  }
  assert.equal(
    sql(
      "select has_table_privilege('authenticated','credential_private.declarations','INSERT') or has_table_privilege('anon','credential_private.declarations','SELECT')",
    ),
    'f',
  );
  assert.deepEqual(snapshot(), before);
  mark('elp-declaration-audit');
  sql(`create sequence credential_private.elp_declaration_proof_attempt;
    create function credential_private.fail_declaration() returns trigger language plpgsql as $$begin
      perform nextval('credential_private.elp_declaration_proof_attempt'); raise exception 'fixture'; end;$$;
    create trigger fail_declaration before insert on credential_private.declarations for each row execute function credential_private.fail_declaration()`);
  await send({}, 503);
  assert.equal(
    sql('select is_called and last_value=1 from credential_private.elp_declaration_proof_attempt'),
    't',
  );
  assert.deepEqual(snapshot(), before);
  sql('drop trigger fail_declaration on credential_private.declarations');
  mark('elp-declaration-readback');
  const declared = await click(declareButton, 'declare_elp', 200);
  const intent = declared.request().postDataJSON();
  await page.getByText(declaredLabel, { exact: true }).waitFor();
  await refresh('not_yet_obtained');
  await page.getByText(declaredLabel, { exact: true }).waitFor();
  const after = snapshot();
  assert.equal(after.declarations.length, 1);
  const [receipt] = after.declarations;
  assert.deepEqual(
    [receipt.organization_id, receipt.membership_id, receipt.actor_id, receipt.operation_id],
    [school, member, actor, intent.operationId],
  );
  assert.ok(Number.isFinite(Date.parse(receipt.declared_at)));
  assert.deepEqual({ ...after, declarations: [] }, before);
  await send(intent, 200);
  await send({ operationId: randomUUID() }, 200);
  assert.deepEqual(snapshot(), after);
  mark('elp-declaration-required');
  for (const value of ['both', 'instructor']) {
    applicability(value);
    await refresh('required');
    await page.getByText(requiredLabel, { exact: true }).waitFor();
    assert.equal(await page.getByText(declaredLabel, { exact: true }).count(), 0);
    await send(intent, 403);
    assert.deepEqual(snapshot(), after);
  }
  applicability('trainee');
  await refresh('not_yet_obtained');
  mark('elp-declaration-pending');
  await page.getByLabel('ELP level').selectOption('5');
  await page.getByLabel('Issue date').fill('2020-01-02');
  await page.getByLabel('Expiry date').fill('2024-01-01');
  await page.getByLabel('Supporting evidence (one PDF or one or two images)').setInputFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: Buffer.from(syntheticSample, 'base64'),
  });
  const submitted = await click('Submit ELP for review', 'submit', 201);
  const pendingId = (await submitted.json()).id;
  const pendingText = 'Pending — ELP Level 5 · 2020-01-02 · 2024-01-01';
  await page.getByText(pendingText, { exact: true }).waitFor();
  assert.ok((await refresh('pending')).some((v) => v.id === pendingId && v.state === 'pending'));
  await page.getByText(pendingText, { exact: true }).waitFor();
  assert.equal(await page.getByText(declaredLabel, { exact: true }).count(), 0);
  const pending = snapshot();
  assert.deepEqual(pending.declarations, after.declarations);
  assert.deepEqual(
    pending.versions.filter((v) => v.id !== pendingId),
    after.versions,
  );
  await send(intent, 409);
  assert.deepEqual(snapshot(), pending);
  mark('elp-declaration-approved');
  await seedApprovedElp();
  const approved = snapshot();
  const rows = await refresh('approved');
  assert.ok(
    rows.some(
      (v) =>
        v.category === 'elp' &&
        v.state === 'approved' &&
        v.elpLevel === 4 &&
        v.expiryDate === '2023-12-31',
    ),
  );
  await page
    .getByText('Current approved — ELP Level 4 · 2020-01-01 · 2023-12-31', { exact: true })
    .waitFor();
  await page.getByText(pendingText, { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: declareButton }).count(), 0);
  assert.equal(await page.getByText(declaredLabel, { exact: true }).count(), 0);
  await send({ operationId: randomUUID() }, 409);
  applicability('both');
  await send(intent, 403);
  await refresh('approved');
  await page.getByText(pendingText, { exact: true }).waitFor();
  assert.deepEqual(snapshot(), approved);
}
