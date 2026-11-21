const stages = new Set([
  'startup-control',
  'sink-positive-control',
  'startup-hook',
  'signup-disabled',
  'recovery',
  'email-otp',
  'legacy-magic-link',
  'signup-resend',
  'admin-invitation',
  'email-change',
  'email-change-resend',
  'email-reauthentication',
  'password-totp-regression',
  'hook-failure-setup',
  'hook-exception',
  'hook-missing',
  'hook-permission-denied',
  'hook-malformed-output',
  'hook-timeout',
  'restored-hook',
  'privacy-and-final-sink',
  'client-cleanup',
  'final-log-privacy',
  'cleanup',
  ...[
    'recovery',
    'email-otp',
    'legacy-magic-link',
    'signup-resend',
    'email-change',
    'email-change-resend',
    'hook-exception',
    'hook-missing',
    'hook-permission-denied',
    'hook-malformed-output',
    'hook-timeout',
    'restored-hook',
  ].map((value) => `${value}-fixture`),
]);
const categories = new Set([
  'configuration',
  'migration',
  'image',
  'health',
  'network',
  'port',
  'timeout',
  'unknown',
  'assertion',
  'cleanup-uncertain',
  'privacy-unverified',
]);
const compatibility = new Set([
  'No-send compatibility: owned network and loopback bindings passed.',
  'No-send compatibility: loopback bindings and local SMTP containment passed.',
]);

// Reconstruct fixed labels only. Never forward JSON, unknown fields, provider
// messages, regression payloads or credentials. Output is capped independently.
export function noSendCiDiagnosticLines(output) {
  const lines = [];
  let cleanup = 'unobserved';
  let evidence = false;
  if (typeof output === 'string')
    for (const line of output.split(/\r?\n/)) {
      if (line.length > 4096 || lines.length >= 64) continue;
      if (compatibility.has(line)) {
        lines.push(line);
        continue;
      }
      try {
        const value = JSON.parse(line)?.noSendBehavior;
        if (!value || !stages.has(value.stage) || typeof value.passed !== 'boolean') continue;
        evidence = true;
        const outcome = value.passed ? 'passed' : 'failed';
        const category = value.passed
          ? ''
          : ` category=${categories.has(value.category) ? value.category : 'unknown'}`;
        lines.push(`No-send runtime: stage=${value.stage} result=${outcome}${category}.`);
        if (value.stage === 'cleanup')
          cleanup = value.passed && cleanup !== 'failed' ? 'passed' : 'failed';
      } catch {
        /* Unreadable evidence is not forwarded. */
      }
    }
  lines.push(
    `No-send runtime evidence: ${evidence ? 'observed' : 'unavailable'}; cleanup=${cleanup}.`,
  );
  return lines;
}
