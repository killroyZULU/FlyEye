// Passive, in-memory diagnostics for the disposable password/TOTP block only.
// Never retain bodies, assertion values, errors, identities or authentication material.
const checkpoints = new Set([
  'fixture-request',
  'fixture-status',
  'fixture-id',
  'fixture-email',
  'fixture-confirmed',
  'login-request',
  'login-status',
  'login-user',
  'login-aal',
  'wrong-password-request',
  'wrong-password-status',
  'wrong-password-code',
  'enroll-request',
  'enroll-status',
  'enroll-id',
  'enroll-secret',
  'bad-challenge-request',
  'bad-challenge-status',
  'bad-verify-request',
  'bad-verify-status',
  'bad-verify-code',
  'good-challenge-request',
  'good-challenge-status',
  'good-verify-request',
  'good-verify-status',
  'good-verify-aal',
  'sink-request',
  'sink-status',
  'sink-count-shape',
  'sink-no-extra-mail',
  'sink-final-count',
]);
const errorCodes = new Set([
  'invalid_credentials',
  'mfa_verification_failed',
  'email_not_confirmed',
  'validation_failed',
  'over_request_rate_limit',
  'mfa_factor_not_found',
  'mfa_challenge_expired',
  'mfa_verification_rejected',
  'unexpected_failure',
]);

export function createNoSendRegressionDiagnostic() {
  let active = false;
  let checkpoint = 'unknown';
  let httpStatus = null;
  let errorCodeField = 'unobserved';
  let errorCategory = 'unknown';
  let readPhase = 'unobserved';
  let readStatus = null;
  let bodyLimit = 'unknown';
  const resetRead = () => {
    readPhase = 'unobserved';
    readStatus = null;
    bodyLimit = 'unknown';
  };
  const resetResponse = () => {
    httpStatus = null;
    errorCodeField = 'unobserved';
    errorCategory = 'unknown';
  };
  return {
    start() {
      active = true;
      checkpoint = 'unknown';
      resetResponse();
      resetRead();
    },
    stop() {
      active = false;
      checkpoint = 'unknown';
      resetResponse();
      resetRead();
    },
    mark(value) {
      if (!active) return;
      checkpoint = checkpoints.has(value) ? value : 'unknown';
      // Clear before argument generation/validation, not only before transport.
      if (checkpoint.endsWith('-request')) {
        resetResponse();
        resetRead();
      }
    },
    request() {
      if (active) {
        resetResponse();
        resetRead();
      }
    },
    transport(step, outcome, status) {
      if (!active || checkpoint !== 'enroll-request') return;
      if (step === 'enrollment-body-limit' && outcome === 'exceeded') {
        bodyLimit = 'exceeded';
        return;
      }
      const phase = new Map([
        ['sink-request:entered', 'request-started'],
        ['sink-request:passed', 'headers-received'],
        ['sink-body:entered', 'body-reading'],
        ['sink-body:passed', 'body-read'],
        ['sink-json:entered', 'json-parsing'],
        ['sink-json:passed', 'json-parsed'],
      ]).get(typeof step === 'string' && typeof outcome === 'string' ? `${step}:${outcome}` : '');
      readPhase = phase ?? 'unknown';
      if (phase === 'headers-received')
        readStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
      if (phase === 'body-read' && bodyLimit !== 'exceeded') bodyLimit = 'within-limit';
    },
    response(result) {
      if (!active) return;
      resetResponse();
      try {
        if (Number.isInteger(result?.status) && result.status >= 100 && result.status <= 599)
          httpStatus = result.status;
        const legacy = result?.body?.error_code;
        const versioned = result?.body?.code;
        // A numeric legacy `code` is the HTTP status, not an error identifier.
        const hasLegacy = typeof legacy === 'string';
        const hasVersioned = typeof versioned === 'string';
        errorCodeField =
          hasLegacy && hasVersioned
            ? 'ambiguous'
            : hasLegacy
              ? 'legacy'
              : hasVersioned
                ? 'versioned'
                : 'absent';
        const code =
          hasLegacy && !hasVersioned ? legacy : hasVersioned && !hasLegacy ? versioned : null;
        errorCategory = errorCodes.has(code) ? code : 'unknown';
      } catch {
        errorCodeField = 'unreadable';
        errorCategory = 'unknown';
      }
    },
    snapshot() {
      return active
        ? {
            regressionDiagnostic: { checkpoint, httpStatus, errorCodeField, errorCategory },
            ...(checkpoint.startsWith('enroll-')
              ? { enrollmentRead: { phase: readPhase, httpStatus: readStatus, bodyLimit } }
              : {}),
          }
        : {};
    },
  };
}
