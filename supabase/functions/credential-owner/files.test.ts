import { z } from 'zod';
import { afterEach, expect, it, vi } from 'vitest';
import { credentialOwnerHandler } from './handler';
import { selectEvidence } from './files';
import { syntheticSamples } from '../../../src/features/credentials/synthetic-samples';

const part = ({ mime, data }: (typeof syntheticSamples)[number]) => ({
  filename:
    'synthetic.' + { 'image/jpeg': 'jpeg', 'image/png': 'png', 'application/pdf': 'pdf' }[mime],
  mime,
  file: data,
});
const parts = [
  part(syntheticSamples[0]),
  part(syntheticSamples[1]),
  part(syntheticSamples[2]),
] as const;
afterEach(() => vi.unstubAllGlobals());

it('validates actual synthetic bytes, file types and the whole ordered set before staging', async () => {
  for (const files of [
    [parts[2]],
    [parts[0]],
    [parts[1]],
    [parts[0], parts[1]],
    [parts[1], parts[0]],
  ]) {
    expect((await selectEvidence({ files }))?.map((p) => p.mime)).toEqual(files.map((p) => p.mime));
  }
  for (const files of [
    [],
    [...parts],
    [parts[2], parts[0]],
    [parts[2], parts[2]],
    [{ ...parts[1], filename: 'mismatch.png' }],
    [{ ...parts[2], file: btoa('%PDF-1.7 /Encrypt malicious') }],
    [parts[0], { ...parts[1], file: parts[1].file.replace(/^./, 'X') }],
  ]) {
    expect(await selectEvidence({ files })).toBeNull();
  }
  expect(await selectEvidence({ files: [parts[1]], ...parts[0] })).toBeNull();
});

it('removes the staged front when uploading the back fails and never calls commit', async () => {
  const school = crypto.randomUUID(),
    actor = crypto.randomUUID(),
    member = crypto.randomUUID(),
    sid = crypto.randomUUID();
  const origin = 'http://127.0.0.1:58329',
    keys = ['front.jpg', 'back.png'];
  const actions: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(url instanceof Request ? url.url : String(url)).pathname;
      if (path.endsWith('/user')) return Response.json({ id: actor });
      if (path.endsWith('credential_request_guard')) return Response.json(true);
      if (path.endsWith('credential_owner_submission')) {
        if (typeof init.body !== 'string') throw Error('Expected JSON body');
        const body = z
          .object({ p_action: z.string(), p_details: z.object({ evidenceManifest: z.unknown() }) })
          .parse(JSON.parse(init.body));
        actions.push(body.p_action);
        expect(body.p_details.evidenceManifest).toEqual(
          [syntheticSamples[1], syntheticSamples[0]].map(({ mime, size, digest }) => ({
            mime,
            size,
            digest,
          })),
        );
        return Response.json({ key: keys[0], keys });
      }
      if (init.method === 'POST' && path.endsWith('/front.jpg')) {
        actions.push('front');
        return Response.json({ Key: keys[0] });
      }
      if (init.method === 'POST' && path.endsWith('/back.png')) {
        actions.push('back failed');
        return Response.json({ message: 'fixture rejection' }, { status: 400 });
      }
      if (init.method === 'DELETE' && path.endsWith('/credential-synthetic')) {
        actions.push('remove');
        if (typeof init.body !== 'string') throw Error('Expected JSON removal');
        expect(
          z.object({ prefixes: z.array(z.string()) }).parse(JSON.parse(init.body)).prefixes,
        ).toEqual([keys[0]]);
        return Response.json([]);
      }
      throw Error('Unexpected fixture call');
    }),
  );
  const handler = credentialOwnerHandler({
    supabaseUrl: 'http://127.0.0.1:58321',
    supabaseServiceRoleKey: 'synthetic-private',
    supabasePublishableKey: 'synthetic-public',
    allowedOrigin: origin,
  });
  const jwt =
    btoa('{"alg":"HS256"}') +
    '.' +
    btoa(
      JSON.stringify({
        sub: actor,
        session_id: sid,
        aal: 'aal2',
        amr: ['password', 'totp'].map((method) => ({ method, timestamp: 100 })),
        exp: 2000000000,
      }),
    ) +
    '.stub';
  const reply = await handler(
    new Request(origin, {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: 'Bearer ' + jwt,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organizationId: school,
        membershipId: member,
        operationId: crypto.randomUUID(),
        expectedPendingId: crypto.randomUUID(),
        action: 'replace',
        category: 'fi',
        issueDate: '2020-01-01',
        expiryDate: null,
        noExpiry: true,
        files: [parts[1], parts[0]],
      }),
    }),
  );
  expect(reply.status).toBe(503);
  expect(actions).toEqual(['prepare', 'front', 'back failed', 'remove']);
});
