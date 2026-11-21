import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const uuid = '[a-f0-9-]{36}';
const routes = new Map([
  [
    'POST',
    new RegExp(
      `^/(admin/users|signup|recover|otp|magiclink|resend|invite|token\\?grant_type=password|factors|factors/${uuid}/(challenge|verify))$`,
    ),
  ],
  ['GET', /^\/(user|reauthenticate|settings)$/],
  ['PUT', /^\/user$/],
]);

export function validateNoSendRequest(origin, method, route, body) {
  assert.equal(origin, 'http://127.0.0.1:58321');
  assert.ok(routes.get(method)?.test(route));
  function check(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'email' || key === 'new_email')
        assert.match(child, /^[a-z0-9-]+@example\.invalid$/);
      else check(child);
    }
  }
  check(body);
}

function isLocalTotpEnrollment(url, options) {
  if (
    url !== 'http://127.0.0.1:58321/auth/v1/factors' ||
    options.method !== 'POST' ||
    typeof options.body !== 'string'
  )
    return false;
  try {
    return JSON.parse(options.body)?.factor_type === 'totp';
  } catch {
    return false;
  }
}

// No redirects, retries, remote origins or raw response/error output.
export async function localJson(url, options = {}, observe = () => {}) {
  const parsed = new URL(url);
  assert.ok(
    parsed.origin === 'http://127.0.0.1:58321' ||
      (url === 'http://127.0.0.1:58324/api/v1/messages' && !options.method && !options.body),
  );
  assert.equal(parsed.username + parsed.password + parsed.hash, '');
  const totpEnrollment = isLocalTotpEnrollment(url, options);
  const bodyLimit = totpEnrollment ? 1048576 : 262144;
  observe('sink-request', 'entered');
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  observe('sink-request', 'passed', response.status);
  observe('sink-body', 'entered');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (totpEnrollment && bytes > bodyLimit) observe('enrollment-body-limit', 'exceeded');
      assert.ok(bytes <= bodyLimit);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  observe('sink-body', 'passed');
  observe('sink-json', 'entered');
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  observe('sink-json', 'passed');
  return { status: response.status, body };
}

// Same base32/HMAC-SHA1 algorithm used by the existing Auth runtime fixture.
export function currentTotp(secret, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.toUpperCase().replace(/=+$/, '')]
    .map((character) => {
      const index = alphabet.indexOf(character);
      assert.ok(index >= 0);
      return index.toString(2).padStart(5, '0');
    })
    .join('');
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  return ((mac.readUInt32BE(mac[19] & 15) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

export function incorrectTotp(secret, now = Date.now()) {
  // Exclude the provider's +/-1 window plus one step for a boundary crossing.
  const valid = new Set([-2, -1, 0, 1, 2].map((step) => currentTotp(secret, now + step * 30000)));
  for (let number = 0; number < 6; number++) {
    const code = number.toString().padStart(6, '0');
    if (!valid.has(code)) return code;
  }
  throw new Error('No synthetic invalid code.');
}
