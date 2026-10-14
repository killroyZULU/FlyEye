import assert from 'node:assert/strict';

export function assertPasswordOnly(token, userId) {
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.equal(claims.sub, userId);
  assert.equal(claims.aal, 'aal1');
  assert.deepEqual([...new Set(claims.amr.map(({ method }) => method))], ['password']);
}

export function assertForeignFactorDenied(before, after, result, checkpoint = () => {}) {
  checkpoint('foreign-denial-status');
  // Preserve SDK transport/status classification without accepting it as ownership denial.
  if (result.error && result.error.status !== 404) throw result.error;
  assert.equal(result.error?.status, 404);
  checkpoint('foreign-denial-code');
  assert.equal(result.error?.code, 'mfa_factor_not_found');
  checkpoint('foreign-denial-data');
  assert.equal(result.data, null);
  checkpoint('foreign-denial-domain');
  for (const actor of before.domain) {
    for (const part of ['members', 'profiles', 'roles']) assert.deepEqual(actor[part], []);
  }
  for (const part of ['domain', 'factors', 'challenges', 'assurance']) {
    checkpoint(`foreign-denial-${part}`);
    assert.deepEqual(after[part], before[part]);
  }
  assert.deepEqual(after, before);
}

export function assertChallengeRequests(requests, factorId) {
  assert.deepEqual(requests, [
    { method: 'POST', path: `/auth/v1/factors/${factorId}/challenge` },
    { method: 'POST', path: `/auth/v1/factors/${factorId}/verify` },
  ]);
}
