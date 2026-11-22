import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';

const route = '/auth/v1/token?grant_type=password';

// A response from the exact loopback request may carry Kong's standard Via
// (proxied response) or Server (Kong-generated response). Never emit headers.
function markedByKong(headers) {
  if (!Array.isArray(headers) || headers.length % 2 !== 0) return false;
  for (let i = 0; i < headers.length; i += 2) {
    if (!Buffer.isBuffer(headers[i]) || !Buffer.isBuffer(headers[i + 1])) continue;
    const name = headers[i].toString().toLowerCase();
    if (
      (name === 'server' || name === 'via') &&
      /^(?:1\.[01] )?kong\/\d+(?:\.\d+)+$/i.test(headers[i + 1].toString())
    )
      return true;
  }
  return false;
}

// Only the two CI churn modes construct this observer. The SDK runs once with
// its original fetch, body, connection policy and timeouts.
export function churnPasswordBoundary(apiUrl) {
  const origin = new URL(apiUrl).origin;
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(origin))
    throw new Error('Expected a local churn API');
  const scope = new AsyncLocalStorage();
  const records = [];

  async function observe(userId, login) {
    const record = { userId, count: 0, sends: 0, headers: false, gateway: false, session: false };
    records.push(record);
    let exact;
    function created({ request }) {
      if (
        scope.getStore() === record &&
        request?.method === 'POST' &&
        request.origin === origin &&
        request.path === route
      ) {
        record.count++;
        exact = request;
      }
    }
    function dispatched({ request }) {
      if (exact && request === exact) record.sends++;
    }
    function received({ request, response }) {
      if (exact && request === exact) {
        record.headers = true;
        record.gateway = markedByKong(response?.headers);
      }
    }
    const listeners = [
      [channel('undici:request:create'), created],
      [channel('undici:client:sendHeaders'), dispatched],
      [channel('undici:request:headers'), received],
    ];
    for (const [ch, listener] of listeners) ch.subscribe(listener);
    try {
      const result = await scope.run(record, login);
      record.session = !result?.error && result?.data?.session?.user?.id === userId;
      return result;
    } finally {
      for (const [ch, listener] of listeners) ch.unsubscribe(listener);
    }
  }

  // Each churn case creates a fresh user. One password-AMR session for that
  // user can establish completion even when the client lost the response.
  // Defer readback until scenario work ends; never use wall-clock proximity.
  function report(readPasswordSessionCount, emit) {
    for (const row of records) {
      const unique =
        row.count === 1 &&
        row.sends <= 1 &&
        records.filter((other) => other.userId === row.userId).length === 1;
      let auth = row.session && row.headers;
      if (unique && !auth) {
        try {
          auth = readPasswordSessionCount(row.userId) === '1';
        } catch {
          /* unknown */
        }
      }
      for (const [stage, observed] of [
        ['churn-client-dispatch', row.sends === 1],
        ['churn-client-headers', row.headers],
        ['churn-gateway-receipt', row.gateway],
        ['churn-auth-completion', auth],
      ]) {
        emit(stage, 'response', unique && observed ? 'observed' : 'unknown');
      }
    }
  }
  return { observe, report };
}
