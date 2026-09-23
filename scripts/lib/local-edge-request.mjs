async function isTransientLocalProxyFailure(response) {
  if (response.status === 502) return true;
  if (response.status !== 503) return false;
  try {
    const payload = await response.clone().json();
    return payload?.message === 'name resolution failed';
  } catch {
    return false;
  }
}

// Keep this test-harness recovery local and bounded. Mutations must already carry
// their idempotency key in init.body; every attempt reuses the identical request.
export async function fetchLocalEdge(url, init, onRetry = () => {}) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
    throw new Error('Local Edge recovery requires a loopback URL.');
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, init);
    if (attempt === 2 || !(await isTransientLocalProxyFailure(response))) return response;
    onRetry(response.status);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
