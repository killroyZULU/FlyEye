import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { syntheticSample } from '../../src/features/credentials/owner-gateway.ts';
import { raceReplacementCommits } from './credential-replacement-race.mjs';

export function assertReplacementReceipt(receipt, expectedVersionId) {
  const expected = z.strictObject({
    state: z.literal('pending'),
    id: z.literal(expectedVersionId),
    validUntil: z.iso.datetime({ offset: true }),
  });
  assert.ok(expected.safeParse(receipt).success, 'Unexpected NTC replacement receipt');
}

export async function proveNtc({
  page,
  school,
  member,
  actor,
  origin,
  apiUrl,
  invoke,
  sql,
  mark,
  stageControlEvidence,
  reloadAndLogin,
  bucket,
}) {
  const png = Buffer.from(syntheticSample, 'base64');
  const snapshot = () =>
    JSON.parse(
      sql(`select jsonb_build_object(
    'versions',(select jsonb_agg(to_jsonb(v) order by id) from credential_private.versions v),
    'events',(select jsonb_agg(to_jsonb(e) order by id) from credential_private.events e),
    'receipts',(select jsonb_agg(to_jsonb(d) order by operation_id) from credential_private.declarations d),
    'objects',(select jsonb_agg(name order by name) from storage.objects where bucket_id='credential-synthetic'))::text`),
    );
  const key = (id) => school + '/' + member + '/' + id + '.png';
  const endpoint = '/functions/v1/credential-owner';
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
  const selectNtc = () => page.getByLabel('Credential category').selectOption('ntc');
  async function refresh(state) {
    const data = await (await click('Refresh submissions', 'status')).json();
    assert.equal(data.ntcCompleteness, state);
    return data.versions.filter((v) => v.category === 'ntc');
  }
  async function submit() {
    await page.getByLabel('Issue date').fill('2020-02-01');
    await page.getByLabel('Expiry date').fill('2023-11-30');
    await page
      .getByLabel('Synthetic supporting PNG')
      .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
    return click('Submit NTC for review', 'submit', 201);
  }
  async function withdraw(expected) {
    const res = await click('Withdraw pending submission', 'withdraw');
    assert.deepEqual(await res.json(), { id: expected, state: 'withdrawn' });
    const intent = res.request().postDataJSON();
    assert.equal(intent.category, 'ntc');
    assert.equal(intent.versionId, expected);
    await page.getByText('Submission withdrawn.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Submit NTC for review', exact: true }).waitFor();
  }
  mark('ntc-sole-withdrawal');
  await selectNtc();
  await click('Declare NTC not yet obtained', 'declare_ntc');
  const declared = 'NTC — Not yet obtained';
  await page.getByText(declared, { exact: true }).waitFor();
  const saved = snapshot().receipts;
  assert.equal(
    saved.filter((d) => d.category === 'ntc' && d.membership_id === member && d.actor_id === actor)
      .length,
    1,
  );
  const first = await submit();
  await withdraw((await first.json()).id);
  mark('ntc-reload-declaration');
  await reloadAndLogin();
  await selectNtc();
  assert.deepEqual(await refresh('not_yet_obtained'), []);
  await page.getByText(declared, { exact: true }).waitFor();
  assert.deepEqual(snapshot().receipts, saved);

  const control = await stageControlEvidence();
  sql(`insert into credential_private.versions(id,organization_id,membership_id,category,state,issued_on,expires_on,no_expiry,
    object_key,submitted_by,operation_id,evidence_sha256) values('${control.id}','${school}','${member}','ntc','approved',
    '2018-01-01','2022-01-01',false,'${control.key}','${actor}',gen_random_uuid(),'${createHash('sha256').update(png).digest('hex')}')`);
  const second = await submit();
  const target = (await second.json()).id;
  const authorization = await second.request().headerValue('authorization');
  assert.ok(authorization);
  const command = {
    ...second.request().postDataJSON(),
    action: 'replace',
    expectedPendingId: target,
    expiryDate: '2025-10-01',
  };
  const stable = snapshot();
  const prior = stable.versions.find((v) => v.id === target);
  assert.equal(prior.category, 'ntc');
  assert.equal(prior.state, 'pending');
  const approved = stable.versions.find((v) => v.id === control.id);
  assert.equal(approved.expires_on, '2022-01-01');
  mark('ntc-competing-replacements');
  const raced = await raceReplacementCommits({
    apiUrl,
    command,
    request: (body) =>
      invoke(
        new Request(origin + endpoint, {
          method: 'POST',
          headers: {
            Origin: origin,
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
      ),
    assertPrepared(ids) {
      const staged = snapshot();
      assert.deepEqual(staged.versions, stable.versions);
      assert.deepEqual(staged.events, stable.events);
      assert.deepEqual(staged.objects, [...stable.objects, ...ids.map(key)].sort());
    },
  });
  assert.deepEqual(raced.map((r) => r.response.status).sort(), [201, 409]);
  const winner = raced.find((r) => r.response.status === 201);
  const loser = raced.find((r) => r.response.status === 409);
  assertReplacementReceipt(await winner.response.json(), winner.versionId);
  mark('ntc-winner-audit-storage');
  const won = snapshot();
  assert.deepEqual(won.objects, [...stable.objects, key(winner.versionId)].sort());
  const folder = school + '/' + member;
  const listed = await bucket.list(folder, { search: loser.versionId });
  assert.equal(listed.error, null);
  assert.deepEqual(listed.data, []);
  const remaining = won.versions.filter((v) => v.category === 'ntc' && v.state === 'pending');
  assert.equal(remaining.length, 1);
  const [next] = remaining;
  assert.deepEqual(
    [
      next.id,
      next.operation_id,
      next.replaces_version_id,
      next.object_key,
      next.submitted_by,
      next.membership_id,
      next.organization_id,
    ],
    [winner.versionId, winner.operationId, target, key(winner.versionId), actor, member, school],
  );
  assert.deepEqual(
    won.versions.find((v) => v.id === target),
    { ...prior, state: 'withdrawn', withdrawal_operation_id: winner.operationId },
  );
  assert.deepEqual(
    won.versions.filter((v) => v.id !== next.id && v.id !== target),
    stable.versions.filter((v) => v.id !== target),
  );
  const oldEvents = new Set(stable.events.map((e) => e.id));
  assert.deepEqual(
    won.events.filter((e) => oldEvents.has(e.id)),
    stable.events,
  );
  const events = won.events.filter((e) => !oldEvents.has(e.id));
  assert.deepEqual(
    events.map((e) => [e.event, e.version_id, e.organization_id, e.actor_id]).sort(),
    [
      ['submitted', winner.versionId, school, actor],
      ['withdrawn', target, school, actor],
    ],
  );
  assert.deepEqual(won.receipts, saved);
  const rows = await refresh('approved');
  assert.equal(rows.length, 2);
  assert.ok(
    rows.some(
      (v) => v.id === winner.versionId && v.state === 'pending' && v.expiryDate === '2025-10-01',
    ),
  );
  await page.getByText(/Pending — NTC radio license.*2025-10-01/).waitFor();
  mark('ntc-withdraw-with-approval');
  await withdraw(winner.versionId);
  assert.deepEqual(await refresh('approved'), [
    {
      id: control.id,
      category: 'ntc',
      state: 'approved',
      issueDate: '2018-01-01',
      expiryDate: '2022-01-01',
      noExpiry: false,
    },
  ]);
  await page.getByText(/Current approved — NTC radio license.*2022-01-01/).waitFor();
  assert.equal(await page.getByText(declared, { exact: true }).count(), 0);
  const final = snapshot();
  assert.deepEqual(
    final.versions.find((v) => v.id === control.id),
    approved,
  );
  assert.deepEqual(final.objects, won.objects);
  assert.deepEqual(final.receipts, saved);
}
