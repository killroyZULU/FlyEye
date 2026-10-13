import assert from 'node:assert/strict';

export function assertPasswordOnly(token, userId) {
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.equal(claims.sub, userId);
  assert.equal(claims.aal, 'aal1');
  assert.deepEqual([...new Set(claims.amr.map(({ method }) => method))], ['password']);
}

export function assertForeignFactorDenied(before, after, result) {
  assert.equal(result.error?.status, 404);
  assert.equal(result.error?.code, 'mfa_factor_not_found');
  assert.equal(result.data, null);
  for (const actor of before.domain) {
    for (const part of ['members', 'profiles', 'roles']) assert.deepEqual(actor[part], []);
  }
  assert.deepEqual(after, before);
}

export function assertChallengeRequests(requests, factorId) {
  assert.deepEqual(requests, [
    { method: 'POST', path: `/auth/v1/factors/${factorId}/challenge` },
    { method: 'POST', path: `/auth/v1/factors/${factorId}/verify` },
  ]);
}
