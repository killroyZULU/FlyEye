import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  syntheticPng,
  syntheticJpeg,
  syntheticPdf,
} from '../../supabase/functions/credential-owner/synthetic-media.ts';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const file = (sample) => ({
  name:
    'synthetic.' +
    { 'image/png': 'png', 'image/jpeg': 'jpeg', 'application/pdf': 'pdf' }[sample.mime],
  mimeType: sample.mime,
  buffer: Buffer.from(sample.data, 'base64'),
});

export async function proveInstructorEvidence({ page, setApplicability, reloadAndLogin }) {
  const sample = (mime, bytes) => ({
    mime,
    data: Buffer.from(bytes).toString('base64'),
    digest: digest(bytes),
  });
  const png = sample('image/png', syntheticPng(23, 12)),
    jpeg = sample('image/jpeg', syntheticJpeg(17, 9)),
    pdf = sample('application/pdf', syntheticPdf(3));
  const choose = (kind) => page.getByLabel('Credential category').selectOption(kind);
  const refresh = () => page.getByRole('button', { name: 'Refresh submissions' }).click();
  const label = (files) =>
    page
      .getByLabel('Supporting evidence (one PDF or one or two images)')
      .setInputFiles(files.map(file));
  async function fill(files) {
    await page.getByLabel('Issue date').fill('2024-01-04');
    await page.getByLabel('Expiry date').fill('2026-05-03');
    await label(files);
  }
  async function clickFor(button, action, status) {
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === '/functions/v1/credential-owner' &&
          r.request().method() === 'POST' &&
          r.request().postDataJSON()?.action === action,
      ),
      page.getByRole('button', { name: button, exact: true }).click(),
    ]);
    assert.equal(res.status(), status);
    return res;
  }
  await setApplicability('both');
  await refresh();
  await page
    .getByRole('option', { name: 'Flight instructor license' })
    .waitFor({ state: 'attached' });
  await choose('fi');
  await page.getByText('Optional — Not provided', { exact: true }).waitFor();
  await fill([jpeg, png]);
  const submission = await clickFor('Submit flight instructor license for review', 'submit', 201);
  const first = (await submission.json()).id;
  const pending = 'Pending — Flight instructor license · 2024-01-04 · 2026-05-03';
  await page.getByText(pending, { exact: true }).waitFor();
  await reloadAndLogin();
  await choose('fi');
  await page.getByText(pending, { exact: true }).waitFor();
  for (const [slot, sample] of [jpeg, png].entries()) {
    const res = await clickFor(
      'View pending evidence (' + (slot === 0 ? 'front' : 'back') + ')',
      'evidence',
      200,
    );
    const body = res.request().postDataJSON();
    assert.equal(body.versionId, first);
    assert.equal(body.slot, slot);
    assert.match(res.headers()['cache-control'], /private, no-store/);
    const image = page.getByAltText('Submitted synthetic supporting evidence');
    const expectedWidth = slot === 0 ? 17 : 23;
    await page.waitForFunction((width) => {
      const img = globalThis.document.querySelector(
        'img[alt="Submitted synthetic supporting evidence"]',
      );
      return (
        img?.complete && img.naturalWidth === width && img.naturalHeight === (width === 17 ? 9 : 12)
      );
    }, expectedWidth);
    const bytes = await image.evaluate(async (img) => {
      if (!img.src.startsWith('blob:' + globalThis.location.origin + '/'))
        throw Error('Unexpected preview origin');
      return [...new Uint8Array(await (await fetch(img.src)).arrayBuffer())];
    });
    assert.equal(digest(Buffer.from(bytes)), sample.digest);
  }
  await setApplicability('trainee');
  await refresh();
  await page.getByText('Not currently required', { exact: true }).waitFor();
  await page.getByText(pending, { exact: true }).waitFor();
  await clickFor('Withdraw pending submission', 'withdraw', 200);
  await page.getByText('Submission withdrawn.', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Submit flight instructor license for review' }).count(),
    0,
  );
  await setApplicability('instructor');
  await refresh();
  await choose('gi');
  await page.getByText('Optional — Not provided', { exact: true }).waitFor();
  await fill([pdf]);
  const gi = await clickFor('Submit ground instructor license for review', 'submit', 201);
  const version = (await gi.json()).id;
  await page
    .getByText('Pending — Ground instructor license · 2024-01-04 · 2026-05-03', { exact: true })
    .waitFor();
  const [download, res] = await Promise.all([
    page.waitForEvent('download'),
    clickFor('Download pending PDF', 'evidence', 200),
  ]);
  assert.equal(res.request().postDataJSON().versionId, version);
  assert.match(res.headers()['content-disposition'], /^attachment/);
  assert.match(res.headers()['cache-control'], /private, no-store/);
  assert.equal(download.suggestedFilename(), 'credential.pdf');
  const hash = createHash('sha256');
  for await (const chunk of await download.createReadStream()) hash.update(chunk);
  assert.equal(hash.digest('hex'), pdf.digest);
}
