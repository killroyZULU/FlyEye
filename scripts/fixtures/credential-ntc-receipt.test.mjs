import { expect, it, vi } from 'vitest';
import { credentialOwnerHandler } from '../../supabase/functions/credential-owner/handler.ts';
import { syntheticSample } from '../../src/features/credentials/owner-gateway.ts';
import { assertReplacementReceipt } from './credential-ntc-lifecycle-proof.mjs';

it('accepts the protected replacement receipt including its deadline, and rejects changed fields', async () => {
  const actor = crypto.randomUUID(),
    session = crypto.randomUUID(),
    member = crypto.randomUUID(),
    school = crypto.randomUUID();
  const origin = 'http://127.0.0.1:58329';
  const deadline = '2026-11-26T12:05:00.123456+00:00';
  let committed;
  vi.stubGlobal('fetch', async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/auth/v1/user') return Response.json({ id: actor });
    if (path.endsWith('/credential_request_guard')) return Response.json(true);
    if (path.endsWith('/credential_owner_submission')) {
      const rpc = JSON.parse(init.body);
      if (rpc.p_action === 'prepare')
        return Response.json({
          key: school + '/' + member + '/' + rpc.p_version + '.png',
          validUntil: deadline,
        });
      if (rpc.p_action === 'commit') {
        committed = rpc.p_version;
        return Response.json({ state: 'pending', id: committed, validUntil: deadline });
      }
    }
    if (init.method === 'POST' && path.startsWith('/storage/v1/object/credential-synthetic/'))
      return Response.json({ Key: path });
    throw Error('Unexpected synthetic dependency call');
  });
  try {
    const handler = credentialOwnerHandler({
      supabaseUrl: 'http://127.0.0.1:58321',
      allowedOrigin: origin,
      supabasePublishableKey: 'synthetic-public',
      supabaseServiceRoleKey: 'synthetic-service',
    });
    const claims = {
      sub: actor,
      session_id: session,
      aal: 'aal2',
      exp: 2000000000,
      amr: ['password', 'totp'].map((method) => ({ method, timestamp: 100 })),
    };
    const response = await handler(
      new Request(origin, {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + btoa('{}') + '.' + btoa(JSON.stringify(claims)) + '.stub',
        },
        body: JSON.stringify({
          action: 'replace',
          category: 'ntc',
          organizationId: school,
          membershipId: member,
          operationId: crypto.randomUUID(),
          expectedPendingId: crypto.randomUUID(),
          issueDate: '2020-02-01',
          expiryDate: '2025-10-01',
          noExpiry: false,
          file: syntheticSample,
          filename: 'synthetic.png',
          mime: 'image/png',
        }),
      }),
    );
    expect(response.status).toBe(201);
    const receipt = await response.json();
    expect(receipt).toEqual({ state: 'pending', id: committed, validUntil: deadline });
    assertReplacementReceipt(receipt, committed);
    for (const patch of [
      { id: crypto.randomUUID() },
      { state: 'withdrawn' },
      { validUntil: undefined },
      { validUntil: 'invalid' },
      { extra: true },
    ]) {
      expect(() => assertReplacementReceipt({ ...receipt, ...patch }, committed)).toThrow();
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
