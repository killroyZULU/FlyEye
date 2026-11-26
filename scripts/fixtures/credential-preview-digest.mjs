// Runs in the checkpoint page. Read the Blob consumed by the app without a second HTTP request.
export async function matchesPreviewDigest(image, expected) {
  const source = new URL(image.src);
  if (source.protocol !== 'blob:' || source.origin !== globalThis.location.origin) return false;
  const response = await fetch(source.href, { credentials: 'omit', redirect: 'error' });
  if (!response.ok) return false;
  const png = await response.blob();
  if (png.type !== 'image/png' || png.size !== expected.size) return false;
  const digest = await crypto.subtle.digest('SHA-256', await png.arrayBuffer());
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return hex === expected.digest;
}
