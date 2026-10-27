const codes = new Map([
  ['ECONNREFUSED', 'transport-connection-refused'],
  ['ECONNRESET', 'transport-connection-reset'],
  ['UND_ERR_SOCKET', 'transport-socket-closed'],
  ['ENOTFOUND', 'transport-dns-failed'],
  ['EAI_AGAIN', 'transport-dns-failed'],
  ['UND_ERR_CONNECT_TIMEOUT', 'transport-timeout'],
  ['UND_ERR_HEADERS_TIMEOUT', 'transport-timeout'],
  ['UND_ERR_BODY_TIMEOUT', 'transport-timeout'],
  ['ERR_INVALID_URL', 'transport-invalid-request'],
  ['ERR_INVALID_ARG_TYPE', 'transport-invalid-request'],
  ['ERR_INVALID_CHAR', 'transport-invalid-request'],
]);

// Disposable Node fixture only. Never change the browser/application transport.
// Close each owned API connection from its first request so no idle socket can
// become stale while synchronous SQL snapshots block the fixture event loop.
export function fixtureConnectionOptions(input, init, apiUrl) {
  const target = new URL(apiUrl);
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (
    target.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    url.origin !== target.origin
  )
    return init;
  const headers = new Headers(
    init.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  headers.set('connection', 'close');
  return { ...init, headers };
}

export function transportDetail(error) {
  // Native fetch normally wraps the useful code in cause; never inspect messages or URLs.
  for (let depth = 0; error && depth < 3; depth += 1, error = error.cause) {
    if (codes.has(error.code)) return codes.get(error.code);
    if (error.name === 'TimeoutError') return 'transport-timeout';
    if (error.name === 'AbortError') return 'transport-aborted';
  }
  return 'transport-unknown';
}

function isFactorRequest(input, method, apiUrl) {
  try {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    return (
      method === 'POST' &&
      url.origin === new URL(apiUrl).origin &&
      /^\/auth\/v1\/factors\/[0-9a-f-]{36}\/(challenge|verify)$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function isPasswordLogin(input, method, apiUrl) {
  try {
    const base = new URL(apiUrl);
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    return (
      method === 'POST' &&
      base.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) &&
      url.origin === base.origin &&
      url.pathname === '/auth/v1/token' &&
      url.searchParams.getAll('grant_type').length === 1 &&
      url.searchParams.get('grant_type') === 'password'
    );
  } catch {
    return false;
  }
}

async function withTransportDiagnostics(operation, { input, method, apiUrl, report }, matches) {
  try {
    return await operation();
  } catch (error) {
    if (matches(input, method, apiUrl)) {
      try {
        report(transportDetail(error));
      } catch {
        // Diagnostic failures cannot replace the original provider failure.
      }
    }
    throw error;
  }
}

export function withFactorTransportDiagnostics(operation, options) {
  return withTransportDiagnostics(operation, options, isFactorRequest);
}

export function withPasswordLoginTransportDiagnostics(operation, options) {
  return withTransportDiagnostics(operation, options, isPasswordLogin);
}
