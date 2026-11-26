import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { passwordActor } from '../../supabase/functions/credential-owner/handler.ts';
import { syntheticSample } from '../../src/features/credentials/owner-gateway.ts';
import { proveForeignDeclarationDenied } from './credential-declaration-scope.mjs';
import { matchesPreviewDigest } from './credential-preview-digest.mjs';

export async function proveNtc({
  page,
  school,
  member,
  actor,
  origin,
  invoke,
  sql,
  mark,
  apiUrl,
  stageControlEvidence,
  seedApprovedElp,
}) {
  const snapshot = () =>
    JSON.parse(
      sql(`select jsonb_build_object(
    'versions',(select jsonb_agg(to_jsonb(v) order by id) from credential_private.versions v),
    'events',(select jsonb_agg(to_jsonb(e) order by id) from credential_private.events e),
    'objects',(select jsonb_agg(jsonb_build_array(id,name,metadata->>'size') order by id) from storage.objects where bucket_id='credential-synthetic'),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(d) order by category),'[]'::jsonb) from credential_private.declarations d))::text`),
    );
  const click = async (name, action, status) => {
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
  const refresh = async (state) => {
    const data = await (await click('Refresh submissions', 'status', 200)).json();
    assert.equal(data.ntcCompleteness, state);
    assert.equal(data.elpCompleteness, 'approved');
    return data.versions.filter((v) => v.category === 'ntc');
  };
  mark('ntc-declaration');
  await page.getByLabel('Credential category').selectOption('ntc');
  const button = 'Declare NTC not yet obtained',
    declaredText = 'NTC — Not yet obtained';
  await page.getByRole('button', { name: button }).waitFor();
  const metadata = await click('Refresh submissions', 'status', 200);
  const authorization = await metadata.request().headerValue('authorization');
  assert.ok(authorization);
  const session = passwordActor(authorization.slice(7), actor)?.p_session;
  assert.match(session, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  const send = async (body, status) => {
    const response = await invoke(
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
    assert.equal(response.status, status);
    return response;
  };
  const elpOperation = randomUUID();
  await send({ action: 'declare_elp', operationId: elpOperation }, 200);
  await seedApprovedElp();
  assert.deepEqual(await refresh('undeclared'), []);
  const before = snapshot();
  assert.deepEqual(before.versions.map((v) => v.category + ':' + v.state).sort(), [
    'elp:approved',
    'mother_license:approved',
    'mother_license:pending',
  ]);
  assert.deepEqual(
    before.receipts.map((d) => [d.category, d.operation_id]),
    [['elp', elpOperation]],
  );
  await send({ action: 'declare_ntc', operationId: elpOperation }, 409);
  const declared = await click(button, 'declare_ntc', 200);
  const intent = declared.request().postDataJSON();
  await page.getByText(declaredText, { exact: true }).waitFor();
  assert.deepEqual(await refresh('not_yet_obtained'), []);
  await page.getByText(declaredText, { exact: true }).waitFor();
  const declaration = snapshot();
  assert.deepEqual(
    { ...declaration, receipts: declaration.receipts.filter((d) => d.category !== 'ntc') },
    before,
  );
  assert.equal(declaration.receipts.length, 2);
  const receipt = declaration.receipts.find((d) => d.category === 'ntc');
  assert.deepEqual(
    [
      receipt.organization_id,
      receipt.membership_id,
      receipt.actor_id,
      receipt.category,
      receipt.operation_id,
    ],
    [school, member, actor, 'ntc', intent.operationId],
  );
  assert.ok(Number.isFinite(Date.parse(receipt.declared_at)));
  await send(intent, 200);
  await send({ ...intent, operationId: randomUUID() }, 200);
  proveForeignDeclarationDenied(sql, school, actor, session, 'declare_ntc');
  assert.deepEqual(snapshot(), declaration);

  // The same private synthetic object is used for two rolled-back submissions, then for the dated approved control.
  const control = await stageControlEvidence();
  const png = Buffer.from(syntheticSample, 'base64'),
    digest = createHash('sha256').update(png).digest('hex');
  const setApplicability = (value) =>
    sql(
      `update public.organization_member_profiles set credential_applicability='${value}' where organization_id='${school}' and membership_id='${member}'`,
    );
  mark('ntc-required');
  for (const value of ['instructor', 'both']) {
    setApplicability(value);
    assert.deepEqual(await refresh('required'), []);
    await page
      .getByText('NTC required — no approved credential on file.', { exact: true })
      .waitFor();
    assert.equal(await page.getByRole('button', { name: button }).count(), 0);
    await page.getByRole('button', { name: 'Submit NTC for review' }).waitFor();
    await send(intent, 403);
    const stable = snapshot();
    sql(`begin; do $proof$
      declare details jsonb:=jsonb_build_object('category','ntc','operationId',gen_random_uuid(),'digest','${digest}',
        'issueDate','2020-02-01','expiryDate',null,'noExpiry',true); reply jsonb; cmd text;
      begin
        foreach cmd in array array['prepare','commit'] loop
          reply:=public.credential_owner_submission('${actor}','${session}',true,'${school}',extract(epoch from now())::bigint+60,'${member}',cmd,'${control.id}',details);
          if (cmd='prepare' and reply->>'key' is distinct from '${control.key}') or
            (cmd='commit' and (reply->>'id' is distinct from '${control.id}' or reply->>'state' is distinct from 'pending'))
            then raise exception 'required NTC submission failed'; end if;
        end loop;
        if not exists(select from credential_private.versions where id='${control.id}' and category='ntc' and no_expiry and submitted_by='${actor}' and membership_id='${member}') or
          (select count(*) from credential_private.events where version_id='${control.id}' and organization_id='${school}' and actor_id='${actor}' and event='submitted')<>1 then raise exception 'missing required NTC submission or audit'; end if;
      end; $proof$; rollback;`);
    assert.deepEqual(snapshot(), stable);
  }
  setApplicability('trainee');
  await refresh('not_yet_obtained');
  mark('ntc-submit');
  await page.getByLabel('Issue date').fill('2020-02-01');
  await page.getByLabel('Expiry date').fill('2023-11-30');
  await page
    .getByLabel('Synthetic supporting PNG')
    .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
  const response = await click('Submit NTC for review', 'submit', 201);
  const id = (await response.json()).id,
    command = response.request().postDataJSON();
  const pendingLabel = 'Pending — NTC radio license · 2020-02-01 · 2023-11-30';
  await page.getByText(pendingLabel, { exact: true }).waitFor();
  assert.deepEqual(await refresh('pending'), [
    {
      id,
      category: 'ntc',
      state: 'pending',
      issueDate: '2020-02-01',
      expiryDate: '2023-11-30',
      noExpiry: false,
    },
  ]);
  await page.getByText(pendingLabel, { exact: true }).waitFor();
  assert.equal(await page.getByText(declaredText, { exact: true }).count(), 0);
  const pending = snapshot();
  const row = pending.versions.find((v) => v.id === id);
  assert.deepEqual(
    [
      row.category,
      row.license_type,
      row.license_number,
      row.elp_level,
      row.membership_id,
      row.organization_id,
      row.submitted_by,
      row.operation_id,
      row.evidence_sha256,
    ],
    ['ntc', null, null, null, member, school, actor, command.operationId, digest],
  );
  assert.deepEqual(
    pending.events
      .filter((e) => e.version_id === id)
      .map((e) => [e.event, e.organization_id, e.actor_id]),
    [['submitted', school, actor]],
  );
  assert.deepEqual(
    pending.versions.filter((v) => v.id !== id),
    before.versions,
  );
  assert.deepEqual(pending.receipts, declaration.receipts);
  assert.equal((await (await send(command, 200)).json()).id, id);
  await send({ ...command, expiryDate: '2024-01-01' }, 409);
  await send({ ...command, operationId: randomUUID() }, 409);
  await send(intent, 409);
  assert.deepEqual(snapshot(), pending);
  mark('ntc-private-preview');
  const image = page.locator('img[alt="Submitted synthetic supporting evidence"]');
  assert.equal(await image.count(), 0);
  const preview = await click('View pending evidence', 'evidence', 200);
  assert.deepEqual(preview.request().postDataJSON(), {
    action: 'evidence',
    organizationId: school,
    membershipId: member,
    versionId: id,
  });
  mark('ntc-preview-cache');
  assert.match(preview.headers()['cache-control'], /private, no-store/);
  mark('ntc-preview-digest');
  assert.equal(await image.evaluate(matchesPreviewDigest, { size: png.length, digest }), true);
  mark('ntc-preview-render');
  await page.waitForFunction(() => {
    const img = globalThis.document.querySelector(
      'img[alt="Submitted synthetic supporting evidence"]',
    );
    return img?.complete && img.naturalWidth === 1;
  });
  mark('ntc-preview-scope-denial');
  await send({ action: 'evidence', versionId: id, membershipId: randomUUID() }, 403);
  mark('ntc-preview-object-inventory');
  const served = snapshot();
  assert.deepEqual(served.objects, pending.objects);
  mark('ntc-preview-access-event');
  assert.deepEqual(
    served.events
      .filter((e) => e.version_id === id && e.event === 'evidence_served')
      .map((e) => e.actor_id),
    [actor],
  );
  mark('ntc-preservation');
  sql(`insert into credential_private.versions(id,organization_id,membership_id,category,state,issued_on,expires_on,no_expiry,object_key,submitted_by,operation_id,evidence_sha256)
    values('${control.id}','${school}','${member}','ntc','approved','2018-01-01','2022-01-01',false,'${control.key}','${actor}',gen_random_uuid(),'${digest}')`);
  const approved = snapshot();
  const rows = await refresh('approved');
  assert.equal(rows.length, 2);
  await page
    .getByText('Current approved — NTC radio license · 2018-01-01 · 2022-01-01', { exact: true })
    .waitFor();
  await page.getByText(pendingLabel, { exact: true }).waitFor();
  assert.equal(await page.getByText(declaredText, { exact: true }).count(), 0);
  await send({ ...intent, operationId: randomUUID() }, 409);
  assert.deepEqual(snapshot(), approved);
  assert.deepEqual(
    approved.versions.filter((v) => v.category !== 'ntc'),
    before.versions,
  );
}
