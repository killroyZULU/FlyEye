// Deterministic, content-free synthetic media. All bytes (including padding, image
// entropy, PDF objects and offsets) are reproduced and compared before acceptance.
// Keep this local synthetic processor separate from any future real-file scanner.
const ascii = (s: string) => new TextEncoder().encode(s);
const maxBytes = 10_000_000,
  maxPixels = 40_000_000;
function join(parts: Uint8Array[]) {
  const length = parts.reduce((n, p) => n + p.length, 0);
  if (length > maxBytes) throw Error('Synthetic file exceeds limit');
  const result = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    result.set(p, at);
    at += p.length;
  }
  return result;
}
const u16 = (n: number) => Uint8Array.of(n >>> 8, n);
const u32 = (n: number) => Uint8Array.of(n >>> 24, n >>> 16, n >>> 8, n);
function validDimensions(w: number, h: number) {
  return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w * h <= maxPixels;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(name: string, data: Uint8Array) {
  const type = ascii(name);
  let crc = 0xffffffff;
  for (const part of [type, data])
    for (const byte of part) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return join([u32(data.length), type, data, u32(~crc)]);
}
// Grayscale, 1-bit PNG. Uncompressed DEFLATE blocks make validation independent
// of a platform's codec and bound memory before any pixel data is allocated.
export function syntheticPng(width: number, height: number, total?: number) {
  if (!validDimensions(width, height)) throw Error('Image dimensions');
  const raw = (Math.ceil(width / 8) + 1) * height;
  const blockCount = Math.ceil(raw / 65535);
  const compressedLength = 2 + 5 * blockCount + raw + 4;
  const base = 57 + compressedLength;
  const target = total ?? base,
    extra = target - base;
  if (!Number.isSafeInteger(target) || target > maxBytes || extra < 0 || (extra > 0 && extra < 12))
    throw Error('PNG size');
  const compressed = new Uint8Array(compressedLength);
  compressed.set([0x78, 0x01]);
  let at = 2;
  for (let left = raw; left > 0;) {
    const n = Math.min(left, 65535);
    compressed.set([n === left ? 1 : 0, n & 255, n >>> 8, ~n & 255, (~n >>> 8) & 255], at);
    at += 5 + n;
    left -= n;
  }
  compressed.set(u32(((raw % 65521) << 16) | 1), at);
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', join([u32(width), u32(height), Uint8Array.of(1, 0, 0, 0, 0)])),
  ];
  if (extra) parts.push(chunk('feYE', new Uint8Array(extra - 12)));
  parts.push(chunk('IDAT', compressed), chunk('IEND', new Uint8Array()));
  return join(parts);
}
function segment(tag: number, data: Uint8Array) {
  return join([Uint8Array.of(255, tag), u16(data.length + 2), data]);
}
// Baseline grayscale JPEG. Each 8x8 block is a zero DC delta and an AC end-of-block.
export function syntheticJpeg(width: number, height: number, total?: number) {
  if (!validDimensions(width, height) || width > 65535 || height > 65535)
    throw Error('Image dimensions');
  const bits = 2 * Math.ceil(width / 8) * Math.ceil(height / 8);
  const entropy = new Uint8Array(Math.ceil(bits / 8));
  if (bits % 8) entropy[entropy.length - 1] = (1 << (8 - (bits % 8))) - 1;
  const lengths = Uint8Array.of(1, ...new Uint8Array(15));
  const parts = [
    Uint8Array.of(255, 216),
    segment(239, join([ascii('FYES'), u16(width), u16(height)])),
    segment(219, Uint8Array.of(0, ...new Uint8Array(64).fill(1))),
    segment(192, join([Uint8Array.of(8), u16(height), u16(width), Uint8Array.of(1, 1, 17, 0)])),
    segment(
      196,
      join([Uint8Array.of(0), lengths, Uint8Array.of(0, 16), lengths, Uint8Array.of(0)]),
    ),
  ];
  const tail = [segment(218, Uint8Array.of(1, 1, 0, 0, 63, 0)), entropy, Uint8Array.of(255, 217)];
  const base = [...parts, ...tail].reduce((n, p) => n + p.length, 0);
  let extra = (total ?? base) - base;
  if (
    !Number.isSafeInteger(extra) ||
    base + extra > maxBytes ||
    extra < 0 ||
    (extra > 0 && extra < 4)
  )
    throw Error('JPEG size');
  while (extra) {
    let n = Math.min(extra, 65537);
    if (extra > n && extra - n < 4) n -= 4;
    parts.push(segment(254, new Uint8Array(n - 4)));
    extra -= n;
  }
  return join([...parts, ...tail]);
}
// One catalog, one page tree and blank leaf pages. No streams, actions or encryption.
export function syntheticPdf(pages: number, total?: number) {
  if (!Number.isInteger(pages) || pages < 1 || pages > 200) throw Error('PDF page count');
  const ids = Array.from({ length: pages }, (_, i) => i + 3 + ' 0 R');
  let body = '%PDF-1.4\n%FlyEye synthetic pages ' + pages + '\n';
  const offsets = [0];
  const add = (value: string) => {
    offsets.push(body.length);
    body += offsets.length - 1 + ' 0 obj\n' + value + '\nendobj\n';
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Count ' + pages + ' /Kids [' + ids.join(' ') + '] >>');
  for (let i = 0; i < pages; i++)
    add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 120] /Resources << >> >>');
  const xref =
    'xref\n0 ' +
    offsets.length +
    '\n0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    'trailer\n<< /Size ' +
    offsets.length +
    ' /Root 1 0 R >>\nstartxref\n';
  const tail = '\n%%EOF\n',
    base = body.length + xref.length + 10 + tail.length,
    extra = (total ?? base) - base;
  if (!Number.isSafeInteger(extra) || extra < 0 || base + extra > maxBytes) throw Error('PDF size');
  // Whitespace before the xref leaves all prior object offsets intact.
  return join([
    ascii(body),
    new Uint8Array(extra).fill(32),
    ascii(xref + String(body.length + extra).padStart(10, '0') + tail),
  ]);
}
export function isGeneratedEvidence(bytes: Uint8Array, mime: string) {
  if (bytes.length < 24 || bytes.length > maxBytes) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const prefix = new TextDecoder().decode(bytes.subarray(0, 64));
  try {
    let expected: Uint8Array;
    if (mime === 'image/png' && view.getUint32(0) === 0x89504e47)
      expected = syntheticPng(view.getUint32(16), view.getUint32(20), bytes.length);
    else if (
      mime === 'image/jpeg' &&
      view.getUint32(0) === 0xffd8ffef &&
      view.getUint32(6) === 0x46594553
    )
      expected = syntheticJpeg(view.getUint16(10), view.getUint16(12), bytes.length);
    else if (mime === 'application/pdf') {
      const m = /^%PDF-1\.4\n%FlyEye synthetic pages ([1-9][0-9]{0,2})\n/.exec(prefix);
      if (!m) return false;
      expected = syntheticPdf(Number(m[1]), bytes.length);
    } else return false;
    return bytes.length === expected.length && bytes.every((b, i) => b === expected[i]);
  } catch {
    return false;
  }
}
