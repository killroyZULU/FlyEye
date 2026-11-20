import http from 'node:http';
import { z } from 'zod';
import { prepareLocalAuthReadback } from './staging-account-reconciliation.mjs';

const origin = 'http://127.0.0.1:58321';
const uncertain = () => ({ decision: 'stop', reason: 'auth-uncertain' });
const timestamp = z.iso.datetime({ offset: true });
const userRecord = z.object({
  id: z.string(),
  email: z.string(),
  email_confirmed_at: timestamp,
  deleted_at: z.null().optional(),
  banned_until: timestamp.nullish(),
  app_metadata: z.object({ flyeye_fixture_create_operation: z.string() }),
});

async function readUser(response) {
  try {
    if (response.statusCode !== 200) return null;
    const chunks = [];
    let size = 0;
    for await (const value of response) {
      size += value.byteLength;
      if (size > 262144) return null;
      chunks.push(value);
    }
    if (!response.complete) return null;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return userRecord.parse(JSON.parse(text));
  } finally {
    response.destroy();
  }
}

// loadStatus must belong to the currently owned disposable project and the caller
// must hold the same lock throughout inventory, readback and journal persistence.
export async function reconcileLocalAuthReadback(ledgerText, observationText, role, loadStatus) {
  const intent = prepareLocalAuthReadback(ledgerText, observationText, role);
  if (intent.decision !== 'read-local-auth') return intent;
  try {
    const status = await loadStatus();
    if (
      status.API_URL !== origin ||
      typeof status.ANON_KEY !== 'string' ||
      !status.ANON_KEY ||
      typeof status.SERVICE_ROLE_KEY !== 'string' ||
      !status.SERVICE_ROLE_KEY
    )
      return uncertain();
    // A fresh direct agent avoids inheriting proxy routing. node:http does not follow redirects.
    const response = await new Promise((resolve, reject) => {
      http
        .get(
          origin + '/auth/v1/admin/users/' + intent.id,
          {
            agent: false,
            signal: AbortSignal.timeout(10000),
            headers: {
              apikey: status.ANON_KEY,
              Authorization: 'Bearer ' + status.SERVICE_ROLE_KEY,
            },
          },
          resolve,
        )
        .once('error', reject);
    });
    const user = await readUser(response);
    if (
      !user ||
      user.id !== intent.id ||
      user.email !== intent.email ||
      user.app_metadata.flyeye_fixture_create_operation !== intent.operationId ||
      Date.parse(user.email_confirmed_at) > Date.now() ||
      (user.banned_until && Date.parse(user.banned_until) > Date.now())
    )
      return uncertain();
    return { decision: 'resume', role, step: 'record-confirmed-auth' };
  } catch {
    return uncertain();
  }
}
