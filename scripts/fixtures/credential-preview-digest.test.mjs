import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { matchesPreviewDigest } from './credential-preview-digest.mjs';

const origin = 'http://127.0.0.1:4173';
const src = 'blob:' + origin + '/fixture';
const bytes = Uint8Array.of(137, 80, 78, 71);
const expected = { size: bytes.length, digest: createHash('sha256').update(bytes).digest('hex') };
afterEach(() => vi.unstubAllGlobals());

it.each([
  ['matching bytes', bytes, 'image/png', true],
  ['same length but changed byte', Uint8Array.of(137, 80, 78, 70), 'image/png', false],
  ['truncated bytes', bytes.slice(1), 'image/png', false],
  ['wrong media type', bytes, 'text/plain', false],
])('compares the application preview: %s', async (_, body, type, matches) => {
  vi.stubGlobal('location', { origin });
  const read = vi.fn(async () => new Response(body, { headers: { 'Content-Type': type } }));
  vi.stubGlobal('fetch', read);
  expect(await matchesPreviewDigest({ src }, expected)).toBe(matches);
  expect(read).toHaveBeenCalledExactlyOnceWith(src, { credentials: 'omit', redirect: 'error' });
});

it.each([origin + '/evidence', 'blob:https://other.invalid/fixture'])(
  'refuses a nonlocal preview before reading it',
  async (src) => {
    vi.stubGlobal('location', { origin });
    const read = vi.fn();
    vi.stubGlobal('fetch', read);
    expect(await matchesPreviewDigest({ src }, expected)).toBe(false);
    expect(read).not.toHaveBeenCalled();
  },
);
