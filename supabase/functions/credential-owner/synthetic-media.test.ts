import { expect, it } from 'vitest';
import { syntheticPng, syntheticJpeg, syntheticPdf, isGeneratedEvidence } from './synthetic-media';
import { selectEvidence, sha256, verifiedBytes, maxFileBytes } from './files';
function encoded(bytes: Uint8Array) {
  const pieces = [];
  for (let i = 0; i < bytes.length; i += 24576)
    pieces.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 24576))));
  return pieces.join('');
}

it.each([
  ['image/png', () => syntheticPng(8000, 5000, maxFileBytes), 'png'],
  ['image/jpeg', () => syntheticJpeg(8000, 5000, maxFileBytes), 'jpg'],
  ['application/pdf', () => syntheticPdf(200, maxFileBytes), 'pdf'],
] as const)(
  'accepts an exact-limit generated %s and refuses excess bytes and altered content',
  async (mime, make, ext) => {
    const bytes = make();
    expect(bytes.byteLength).toBe(10_000_000);
    const body = { mime, filename: 'fixture.' + ext, file: encoded(bytes) };
    const parts = await selectEvidence({ files: [body] });
    expect(parts?.[0]?.digest).toBe(await sha256(bytes));
    expect(await selectEvidence({ files: [{ ...body, file: body.file + 'AAAA' }] })).toBeNull();
    bytes[bytes.length - 2] = bytes[bytes.length - 2]! ^ 1;
    expect(isGeneratedEvidence(bytes, mime)).toBe(false);
    expect(
      await verifiedBytes(new Blob([bytes]), {
        mime,
        size: bytes.length,
        digest: parts?.[0]?.digest,
      }),
    ).toBeNull();
  },
);
it('rejects out-of-policy dimensions, page counts, encryption and extra structured content', () => {
  for (const make of [syntheticPng, syntheticJpeg]) expect(() => make(8000, 5001)).toThrow();
  expect(() => syntheticPdf(201)).toThrow();
  const png = syntheticPng(8000, 5000);
  new DataView(png.buffer).setUint32(20, 5001);
  expect(isGeneratedEvidence(png, 'image/png')).toBe(false);
  const jpeg = syntheticJpeg(8000, 5000);
  new DataView(jpeg.buffer).setUint16(12, 5001);
  expect(isGeneratedEvidence(jpeg, 'image/jpeg')).toBe(false);
  const pdf = new TextDecoder().decode(syntheticPdf(200));
  for (const content of [
    pdf.replace('pages 200', 'pages 201'),
    pdf.replace('/Root', '/Encrypt'),
    pdf + 'trailing content',
  ])
    expect(isGeneratedEvidence(new TextEncoder().encode(content), 'application/pdf')).toBe(false);
});
