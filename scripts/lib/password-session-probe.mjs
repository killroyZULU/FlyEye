import assert from 'node:assert/strict';

import { createClient } from '@supabase/supabase-js';

// Generate a local recovery session without sending mail or changing the password.
// The caller owns the synthetic identity and deletes it, including its sessions.
export async function recoveryOnlyAccessToken(server, apiUrl, publishableKey, email) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiUrl).hostname)) {
    throw new Error('Password-session probes require a local synthetic target.');
  }
  const { data: generated, error: generationError } = await server.auth.admin.generateLink({
    type: 'recovery',
    email,
  });
  if (generationError || !generated.properties?.hashed_token) {
    throw new Error('Synthetic recovery-session generation failed.');
  }
  const client = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.verifyOtp({
    type: 'recovery',
    token_hash: generated.properties.hashed_token,
  });
  if (error || !data.session) throw new Error('Synthetic recovery verification failed.');
  const payload = JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64url'));
  assert.equal(payload.aal, 'aal1');
  assert.deepEqual(
    payload.amr.map((entry) => entry.method),
    ['otp'],
  );
  return data.session.access_token;
}
