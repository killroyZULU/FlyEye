// Self-contained: serialized into an owned, disposable import-map substitution.
// Never await tracing or inspect a request/response body on the handler path.
export function traceBootstrapHandler(handler, { key, origin, crypto, emit }) {
  if (!/^[a-f0-9]{64}$/.test(key ?? '') || !origin) return handler;
  let observations = 0;
  const encoder = new TextEncoder();
  function tag(request) {
    if (request.method !== 'POST' || request.headers.get('origin') !== origin) return;
    if (
      !['/auth-bootstrap', '/functions/v1/auth-bootstrap'].includes(new URL(request.url).pathname)
    )
      return;
    const authorization = request.headers.get('authorization');
    if (!authorization || ++observations > 32) return;
    return crypto.subtle
      .importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then((signingKey) => crypto.subtle.sign('HMAC', signingKey, encoder.encode(authorization)))
      .then((bytes) =>
        [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join(''),
      );
  }
  return function observed(request) {
    let correlation;
    const record = (event) => {
      try {
        correlation
          ?.then((value) => emit(`FLYEYE_BOOTSTRAP_TRACE_V1 ${value} ${event}`))
          .catch(() => {});
      } catch {
        // Observation failure cannot replace the original result.
      }
    };
    try {
      correlation = tag(request);
      record('entry');
    } catch {
      // Missing observation is unknown, not evidence that the handler did not run.
    }
    try {
      const result = handler(request);
      const completed = (response) => {
        try {
          record(response.status === 503 ? 'returned-503' : 'returned-non503');
        } catch {
          record('unknown');
        }
      };
      if (result instanceof Promise) {
        result.then(completed, () => record('threw')).catch(() => {});
      } else completed(result);
      return result;
    } catch (error) {
      record('threw');
      throw error;
    }
  };
}
