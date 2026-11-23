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
const corsPolicy = new Map([
  ['DisallowedByMode', 'password-devtools-cors-disallowed-by-mode'],
  ['CorsDisabledScheme', 'password-devtools-cors-disabled-scheme'],
  ['InsecureLocalNetwork', 'password-devtools-insecure-local-network'],
  ['InvalidLocalNetworkAccess', 'password-devtools-invalid-local-network-access'],
  [
    'LocalNetworkAccessPermissionDenied',
    'password-devtools-local-network-access-permission-denied',
  ],
  ['RedirectContainsCredentials', 'password-devtools-redirect-contains-credentials'],
  ['NoCorsRedirectModeNotFollow', 'password-devtools-no-cors-redirect-mode-not-follow'],
]);
const blockedPolicy = new Map([
  ['csp', 'password-devtools-csp'],
  ['mixed-content', 'password-devtools-mixed-content'],
  ['origin', 'password-devtools-origin'],
  ['inspector', 'password-devtools-inspector'],
  ['integrity', 'password-devtools-integrity'],
  ['subresource-filter', 'password-devtools-subresource-filter'],
  ['content-type', 'password-devtools-content-type'],
  ['corp-not-same-origin', 'password-devtools-corp-not-same-origin'],
  ['corp-not-same-site', 'password-devtools-corp-not-same-site'],
]);
export const passwordPolicyMarkers = Object.freeze([
  ...corsPolicy.values(),
  ...blockedPolicy.values(),
]);

function category(event) {
  const cors = event.corsErrorStatus?.corsError;
  if (preflight.has(cors)) return 'password-devtools-preflight-rejection';
  if (response.has(cors)) return 'password-devtools-response-cors-rejection';
  const corsMarker = corsPolicy.get(cors);
  const blockedMarker = blockedPolicy.get(event.blockedReason);
  if (corsMarker && blockedMarker) return unknown;
  return corsMarker ?? blockedMarker ?? unknown;
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
