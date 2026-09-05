async function isTransientLocalProxyFailure(response) {
  if (response.status === 502) return true;
  if (response.status !== 503) return false;
  return (await response.clone().text()).includes('"message":"name resolution failed"');
}

export async function fetchLocalEdge(url, init) {
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, init);
    if (!(await isTransientLocalProxyFailure(response)) || attempt === 2) return response;
    // Reuse the exact request so mutation idempotency protects an uncertain first attempt.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return response;
}
