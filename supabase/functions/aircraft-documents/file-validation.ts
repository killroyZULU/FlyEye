export type AllowedMediaType = 'application/pdf' | 'image/jpeg' | 'image/png';

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
  return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) };
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      return {
        height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      };
    }
    offset += 2 + length;
  }
  return null;
}

function validPdf(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') return false;
  const tail = new TextDecoder().decode(bytes.slice(Math.max(0, bytes.length - 2048)));
  if (!tail.includes('%%EOF')) return false;
  const text = new TextDecoder('latin1').decode(bytes);
  const pages = text.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  return pages >= 1 && pages <= 200;
}

function signatureAndBounds(bytes: Uint8Array, mediaType: AllowedMediaType): boolean {
  if (mediaType === 'application/pdf') return validPdf(bytes);
  const dimensions = mediaType === 'image/png' ? pngDimensions(bytes) : jpegDimensions(bytes);
  return Boolean(
    dimensions &&
    dimensions.width > 0 &&
    dimensions.height > 0 &&
    dimensions.width * dimensions.height <= 40_000_000,
  );
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function validateSyntheticFile(input: {
  bytes: Uint8Array;
  mediaType: AllowedMediaType;
  expectedSize: number;
  expectedHash: string;
}): Promise<'clean' | 'rejected'> {
  if (input.bytes.length !== input.expectedSize || input.bytes.length > 20 * 1024 * 1024) {
    return 'rejected';
  }
  if ((await sha256Hex(input.bytes)) !== input.expectedHash) return 'rejected';
  if (!signatureAndBounds(input.bytes, input.mediaType)) return 'rejected';
  const sample = new TextDecoder('latin1').decode(input.bytes.slice(0, 8192));
  if (sample.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') || sample.includes('X5O!P%@AP')) {
    return 'rejected';
  }
  return 'clean';
}
