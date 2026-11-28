import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { syntheticSample } from '../../src/features/credentials/owner-gateway.ts';

export async function proveElp({ page, sql, school, member, actor, mark, origin, invoke, apiUrl }) {
  const snapshot = () =>
    JSON.parse(
      sql(`select jsonb_build_object(
    'versions',(select jsonb_agg(to_jsonb(v) order by id) from credential_private.versions v),
    'events',(select jsonb_agg(to_jsonb(e) order by id) from credential_private.events e),
    'objects',(select jsonb_agg(jsonb_build_array(id,name,metadata->>'size') order by id) from storage.objects where bucket_id='credential-synthetic'))::text`),
    );
  const before = snapshot();
  assert.deepEqual(before.versions.map((v) => v.category + ':' + v.state).sort(), [
    'mother_license:approved',
    'mother_license:pending',
  ]);
  mark('elp-migration');
  sql(readFileSync(new URL('./credential-elp-migration.sql', import.meta.url), 'utf8'));
  assert.deepEqual(snapshot(), before);
  const responseFor = (action) =>
    page.waitForResponse(
      (r) =>
        r.url() === apiUrl + '/functions/v1/credential-owner' &&
        r.request().method() === 'POST' &&
        r.request().postDataJSON()?.action === action,
    );
  mark('elp-owner-submit');
  await page.getByLabel('Credential category').selectOption('elp');
  await page.getByLabel('ELP level').selectOption('6');
  assert.equal(await page.getByLabel('No expiry').isChecked(), false);
  await page.getByLabel('Issue date').fill('2020-01-15');
  await page.getByLabel('Expiry date').fill('2023-06-30');
  await page.getByLabel('Supporting evidence (one PDF or one or two images)').setInputFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: Buffer.from(syntheticSample, 'base64'),
  });
  const [response] = await Promise.all([
    responseFor('submit'),
    page.getByRole('button', { name: 'Submit ELP for review' }).click(),
  ]);
  assert.equal(response.status(), 201);
  const { id } = await response.json(),
    intent = response.request().postDataJSON();
  const authorization = await response.request().headerValue('authorization');
  assert.equal(intent.category, 'elp');
  const label = 'Pending — ELP Level 6 · 2020-01-15 · 2023-06-30';
  await page.getByText(label, { exact: true }).waitFor();
  mark('elp-refresh');
  const [readback] = await Promise.all([
    responseFor('status'),
    page.getByRole('button', { name: 'Refresh submissions' }).click(),
  ]);
  assert.equal(readback.status(), 200);
  assert.deepEqual(
    (await readback.json()).versions.find((v) => v.id === id),
    {
      id,
      category: 'elp',
      state: 'pending',
      elpLevel: 6,
      issueDate: '2020-01-15',
      expiryDate: '2023-06-30',
      noExpiry: false,
    },
  );
  await page.getByText(label, { exact: true }).waitFor();
  const committed = snapshot();
  assert.deepEqual(
    committed.versions.filter((v) => v.category === 'mother_license'),
    before.versions,
  );
  const rows = committed.versions.filter((v) => v.category === 'elp');
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.deepEqual(
    [
      row.id,
      row.operation_id,
      row.organization_id,
      row.membership_id,
      row.submitted_by,
      row.state,
      row.elp_level,
      row.license_type,
      row.license_number,
      row.issued_on,
      row.expires_on,
      row.no_expiry,
    ],
    [
      id,
      intent.operationId,
      school,
      member,
      actor,
      'pending',
      6,
      null,
      null,
      '2020-01-15',
      '2023-06-30',
      false,
    ],
  );
  const events = committed.events.filter((e) => e.version_id === id);
  assert.equal(events.length, 1);
  assert.deepEqual(
    [events[0].event, events[0].actor_id, events[0].organization_id],
    ['submitted', actor, school],
  );
  assert.deepEqual(
    committed.events.filter((e) => e.version_id !== id),
    before.events,
  );
  assert.equal(committed.objects.length, before.objects.length + 1);
  assert.ok(committed.objects.some(([, key, size]) => key === row.object_key && size === '69'));
  const send = (body) =>
    invoke(
      new Request(origin + '/functions/v1/credential-owner', {
        method: 'POST',
        headers: {
          Origin: origin,
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );
  mark('elp-replay');
  assert.equal((await send(intent)).status, 200);
  assert.equal((await send({ ...intent, elpLevel: 5 })).status, 409);
  for (const changed of [{ membershipId: randomUUID() }, { organizationId: randomUUID() }]) {
    assert.equal((await send({ ...intent, ...changed })).status, 403);
  }
  for (const action of ['withdraw', 'replace']) {
    const command =
      action === 'withdraw'
        ? { action, versionId: id, operationId: randomUUID() }
        : {
            action,
            expectedPendingId: id,
            operationId: randomUUID(),
            licenseType: 'PPL',
            licenseNumber: 'SYN',
            issueDate: intent.issueDate,
            expiryDate: intent.expiryDate,
            noExpiry: false,
            filename: intent.filename,
            file: intent.file,
            mime: intent.mime,
          };
    assert.equal(
      (await send({ organizationId: school, membershipId: member, ...command })).status,
      403,
    );
  }
  assert.deepEqual(snapshot(), committed);
  mark('elp-preview');
  await page.getByRole('button', { name: 'View pending evidence' }).click();
  await page.waitForFunction(() => {
    const img = globalThis.document.querySelector(
      'img[alt="Submitted synthetic supporting evidence"]',
    );
    return img?.complete && img.naturalWidth === 1;
  });
  const final = snapshot();
  assert.deepEqual(final.versions, committed.versions);
  assert.equal(
    final.events.filter(
      (e) => e.version_id === id && e.actor_id === actor && e.event === 'evidence_served',
    ).length,
    1,
  );
}
