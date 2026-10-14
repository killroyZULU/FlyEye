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

function transportDetail(error) {
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

export async function withFactorTransportDiagnostics(operation, { input, method, apiUrl, report }) {
  try {
    return await operation();
  } catch (error) {
    if (isFactorRequest(input, method, apiUrl)) {
      try {
        report(transportDetail(error));
      } catch {
        // Diagnostic failures cannot replace the original provider failure.
      }
    }
    throw error;
  }
}
