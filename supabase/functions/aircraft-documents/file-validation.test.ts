import { describe, expect, it } from 'vitest';

import { sha256Hex, validateSyntheticFile } from './file-validation';

function png(extra = ''): Uint8Array {
  const bytes = new Uint8Array(24 + extra.length);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(bytes.buffer).setUint32(16, 100);
  new DataView(bytes.buffer).setUint32(20, 100);
  bytes.set(new TextEncoder().encode(extra), 24);
  return bytes;
}

async function decision(bytes: Uint8Array, expectedSize = bytes.length) {
  return validateSyntheticFile({
    bytes,
    mediaType: 'image/png',
    expectedSize,
    expectedHash: await sha256Hex(bytes),
  });
}

describe('deterministic aircraft document file validation', () => {
  it('accepts a bounded PNG with matching size and hash', async () => {
    await expect(decision(png())).resolves.toBe('clean');
  });

  it('rejects size, hash, signature, dimension, and synthetic malware failures', async () => {
    const valid = png();
    await expect(decision(valid, valid.length + 1)).resolves.toBe('rejected');
    await expect(
      validateSyntheticFile({
        bytes: valid,
        mediaType: 'image/png',
        expectedSize: valid.length,
        expectedHash: '0'.repeat(64),
      }),
    ).resolves.toBe('rejected');
    await expect(decision(new Uint8Array(24))).resolves.toBe('rejected');
    const oversized = png();
    new DataView(oversized.buffer).setUint32(16, 40_000_001);
    await expect(decision(oversized)).resolves.toBe('rejected');
    await expect(decision(png('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))).resolves.toBe('rejected');
  });

  it('accepts a bounded PDF and rejects a PDF without pages or EOF', async () => {
    const valid = new TextEncoder().encode('%PDF-1.7\n1 0 obj <</Type /Page>> endobj\n%%EOF');
    await expect(
      validateSyntheticFile({
        bytes: valid,
        mediaType: 'application/pdf',
        expectedSize: valid.length,
        expectedHash: await sha256Hex(valid),
      }),
    ).resolves.toBe('clean');
    const invalid = new TextEncoder().encode('%PDF-1.7\nno pages');
    await expect(
      validateSyntheticFile({
        bytes: invalid,
        mediaType: 'application/pdf',
        expectedSize: invalid.length,
        expectedHash: await sha256Hex(invalid),
      }),
    ).resolves.toBe('rejected');
  });
});
