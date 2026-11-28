import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { syntheticSample } from '../../src/features/credentials/owner-gateway.ts';
import { matchesPreviewDigest } from './credential-preview-digest.mjs';

export async function proveMedical({
  page,
  reloadAndLogin,
  school,
  member,
  actor,
  sql,
  mark,
  stageControlEvidence,
  origin,
  invoke,
  apiUrl,
}) {
  const png = Buffer.from(syntheticSample, 'base64');
  const digest = createHash('sha256').update(png).digest('hex');
  const endpoint = '/functions/v1/credential-owner';
  const snapshot = () =>
    JSON.parse(
      sql(`select jsonb_build_object(
    'versions',(select jsonb_agg(to_jsonb(v) order by id) from credential_private.versions v where category='medical'),
    'events',(select coalesce(jsonb_agg(jsonb_build_array(e.version_id,e.event,e.actor_id,e.organization_id) order by e.event),'[]'::jsonb)
      from credential_private.events e join credential_private.versions v on v.id=e.version_id where v.category='medical'),
    'private',(select not public from storage.buckets where id='credential-synthetic'))::text`),
    );
  const click = async (name, action, status = 200) => {
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url() === apiUrl + endpoint &&
          r.request().method() === 'POST' &&
          r.request().postDataJSON()?.action === action,
      ),
      page.getByRole('button', { name, exact: true }).click(),
    ]);
    assert.equal(res.status(), status);
    return res;
  };
  const selectMedical = () => page.getByLabel('Credential category').selectOption('medical');
  const medicalRows = async () =>
    (await (await click('Refresh submissions', 'status')).json()).versions.filter(
      (v) => v.category === 'medical',
    );
  mark('medical-approved-control');
  const control = await stageControlEvidence();
  sql(`insert into credential_private.versions(id,organization_id,membership_id,category,state,issued_on,expires_on,no_expiry,
    object_key,submitted_by,operation_id,evidence_sha256) values('${control.id}','${school}','${member}','medical','approved',
    '2018-01-01','2022-01-01',false,'${control.key}','${actor}',gen_random_uuid(),'${digest}')`);
  const before = snapshot();
  assert.equal(before.private, true);
  assert.equal(before.versions.length, 1);
  const [approved] = before.versions;
  assert.deepEqual(
    [approved.id, approved.state, approved.expires_on],
    [control.id, 'approved', '2022-01-01'],
  );
  await selectMedical();
  const approvedLabel = 'Current approved — Medical certificate · 2018-01-01 · 2022-01-01';
  await page.getByText(approvedLabel, { exact: true }).waitFor();
  mark('medical-submit');
  await page.getByLabel('Issue date').fill('2020-02-01');
  await page.getByLabel('Expiry date').fill('2023-11-30');
  await page
    .getByLabel('Supporting evidence (one PDF or one or two images)')
    .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
  const submission = await click('Submit medical certificate for review', 'submit', 201);
  const id = (await submission.json()).id;
  const intent = submission.request().postDataJSON();
  assert.equal(intent.category, 'medical');
  const pendingLabel = 'Pending — Medical certificate · 2020-02-01 · 2023-11-30';
  await page.getByText(pendingLabel, { exact: true }).waitFor();
  mark('medical-reload-readback');
  await reloadAndLogin();
  await selectMedical();
  const rows = await medicalRows();
  const expected = (id, state, issueDate, expiryDate) => ({
    id,
    category: 'medical',
    state,
    issueDate,
    expiryDate,
    noExpiry: false,
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.find((v) => v.state === 'pending'),
    expected(id, 'pending', '2020-02-01', '2023-11-30'),
  );
  assert.deepEqual(
    rows.find((v) => v.state === 'approved'),
    expected(control.id, 'approved', '2018-01-01', '2022-01-01'),
  );
  await page.getByText(pendingLabel, { exact: true }).waitFor();
  await page.getByText(approvedLabel, { exact: true }).waitFor();
  mark('medical-private-preview');
  const image = page.getByAltText('Submitted synthetic supporting evidence', { exact: true });
  assert.equal(await image.count(), 0);
  const preview = await click('View pending evidence', 'evidence');
  assert.deepEqual(preview.request().postDataJSON(), {
    action: 'evidence',
    organizationId: school,
    membershipId: member,
    versionId: id,
  });
  assert.match(preview.headers()['cache-control'], /private, no-store/);
  assert.equal(await image.evaluate(matchesPreviewDigest, { size: png.length, digest }), true);
  await page.waitForFunction(() => {
    const img = globalThis.document.querySelector(
      'img[alt="Submitted synthetic supporting evidence"]',
    );
    return img?.complete && img.naturalWidth === 1;
  });
  mark('medical-preview-scope');
  const authorization = await preview.request().headerValue('authorization');
  assert.ok(authorization);
  const denied = await invoke(
    new Request(origin + endpoint, {
      method: 'POST',
      headers: { Origin: origin, Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: school,
        membershipId: randomUUID(),
        action: 'evidence',
        versionId: id,
      }),
    }),
  );
  assert.equal(denied.status, 403);
  mark('medical-approval-audit');
  const after = snapshot();
  assert.equal(after.private, true);
  assert.equal(after.versions.length, 2);
  assert.deepEqual(
    after.versions.find((v) => v.id === approved.id),
    approved,
  );
  const pending = after.versions.find((v) => v.id === id);
  assert.deepEqual(
    [
      pending.category,
      pending.state,
      pending.organization_id,
      pending.membership_id,
      pending.submitted_by,
      pending.operation_id,
      pending.issued_on,
      pending.expires_on,
      pending.no_expiry,
      pending.evidence_sha256,
      pending.object_key,
      pending.license_number,
      pending.license_type,
      pending.elp_level,
    ],
    [
      'medical',
      'pending',
      school,
      member,
      actor,
      intent.operationId,
      '2020-02-01',
      '2023-11-30',
      false,
      digest,
      school + '/' + member + '/' + id + '.png',
      null,
      null,
      null,
    ],
  );
  assert.deepEqual(after.events, [
    [id, 'evidence_served', actor, school],
    [id, 'submitted', actor, school],
  ]);
}
