const unknown = 'password-devtools-unknown';
const preflight = new Set([
  'PreflightInvalidStatus',
  'PreflightDisallowedRedirect',
  'PreflightWildcardOriginNotAllowed',
  'PreflightMissingAllowOriginHeader',
  'PreflightMultipleAllowOriginValues',
  'PreflightInvalidAllowOriginValue',
  'PreflightAllowOriginMismatch',
  'PreflightInvalidAllowCredentials',
  'PreflightMissingAllowExternal',
  'PreflightInvalidAllowExternal',
  'InvalidAllowMethodsPreflightResponse',
  'InvalidAllowHeadersPreflightResponse',
  'MethodDisallowedByPreflightResponse',
  'HeaderDisallowedByPreflightResponse',
]);
const response = new Set([
  'MissingAllowOriginHeader',
  'MultipleAllowOriginValues',
  'InvalidAllowOriginValue',
  'AllowOriginMismatch',
  'WildcardOriginNotAllowed',
  'InvalidAllowCredentials',
]);
const otherCorsBlock = new Set([
  'DisallowedByMode',
  'CorsDisabledScheme',
  'InsecureLocalNetwork',
  'InvalidLocalNetworkAccess',
  'LocalNetworkAccessPermissionDenied',
  'RedirectContainsCredentials',
  'NoCorsRedirectModeNotFollow',
]);
const browserBlock = new Set([
  'csp',
  'mixed-content',
  'origin',
  'inspector',
  'integrity',
  'subresource-filter',
  'content-type',
  'corp-not-same-origin',
  'corp-not-same-site',
]);

function category(event) {
  const cors = event.corsErrorStatus?.corsError;
  if (preflight.has(cors)) return 'password-devtools-preflight-rejection';
  if (response.has(cors)) return 'password-devtools-response-cors-rejection';
  if (otherCorsBlock.has(cors) || browserBlock.has(event.blockedReason))
    return 'password-devtools-other-browser-block';
  return unknown;
}

// Keep only an ephemeral protocol ID and a fixed verdict. Never retain event payloads.
export async function observeDevToolsFailure(page, endpoint) {
  let session,
    requestId,
    ambiguous = false,
    terminal,
    enabled = false;
  const issued = (event) => {
    if (requestId && event.requestId === requestId) ambiguous = true; // redirects can reuse IDs
    if (event.request.method !== 'POST' || event.request.url !== endpoint) return;
    if (requestId || event.redirectResponse || !event.requestId) ambiguous = true;
    requestId = event.requestId;
  };
  const failed = (event) => {
    if (!requestId || event.requestId !== requestId) return;
    if (terminal) ambiguous = true;
    terminal = category(event);
  };
  try {
    session = await page.context().newCDPSession(page);
    session.on('Network.requestWillBeSent', issued);
    session.on('Network.loadingFailed', failed);
    await session.send('Network.enable', { maxPostDataSize: 0 });
    enabled = true;
  } catch {
    // An unavailable observer must leave the original browser operation intact.
  }
  return {
    result: () => (enabled && !ambiguous && terminal ? terminal : unknown),
    async close() {
      if (!session) return;
      session.off('Network.requestWillBeSent', issued);
      session.off('Network.loadingFailed', failed);
      await session.detach().catch(() => {}); // browser shutdown also closes the session
    },
  };
}
