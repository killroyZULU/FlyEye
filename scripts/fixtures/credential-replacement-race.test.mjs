import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { raceReplacementCommits } from './credential-replacement-race.mjs';

afterEach(() => vi.unstubAllGlobals());
it('holds both pinned-client commit calls before forwarding either and restores transport', async () => {
  const apiUrl = 'http://127.0.0.1:58321';
  const wire = vi.fn(() => Promise.resolve(Response.json({ ok: true })));
  vi.stubGlobal('fetch', wire);
  const client = createClient(apiUrl, 'synthetic-public', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const expectedPendingId = crypto.randomUUID();
  const witness = vi.fn((ids) => {
    expect(ids).toHaveLength(2);
    expect(wire).toHaveBeenCalledTimes(0);
  });
  const outcomes = await raceReplacementCommits({
    apiUrl,
    command: { expectedPendingId },
    assertPrepared: witness,
    async request(details) {
      const { error } = await client.rpc('credential_owner_submission', {
        p_action: 'commit',
        p_details: details,
        p_version: crypto.randomUUID(),
      });
      expect(error).toBeNull();
      return new Response();
    },
  });
  expect(witness).toHaveBeenCalledOnce();
  expect(outcomes).toHaveLength(2);
  expect(wire).toHaveBeenCalledTimes(2);
  expect(globalThis.fetch).toBe(wire);
});
