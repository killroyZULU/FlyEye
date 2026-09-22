const feat006Stages = new Set([
  'fixture-setup',
  'edge-startup',
  'password-sign-in',
  'readiness-status',
  'enrollment-start',
  'totp-enroll',
  'factor-inventory',
  'factor-bind',
  'totp-verify',
  'readiness-complete',
  'persistence-assertions',
  'fixture-cleanup',
]);
const events = new Set(['enter', 'passed', 'failed']);
const feat003Pattern = /^FEAT-003 runtime diagnostic: stage=[a-z0-9-]+ event=(?:enter|passed)\.$/;
const feat006Pattern = /^FEAT-006 runtime diagnostic: stage=([a-z0-9-]+) event=([a-z]+)\.$/;

export function feat006Diagnostic(stage, event) {
  if (!feat006Stages.has(stage) || !events.has(event)) {
    throw new Error('Unsupported FEAT-006 runtime diagnostic.');
  }
  return `FEAT-006 runtime diagnostic: stage=${stage} event=${event}.`;
}

export function runtimeDiagnosticLines(fixture, output) {
  if (typeof output !== 'string') return [];
  return output.split(/\r?\n/).filter((line) => {
    if (fixture === 'test-feat-003-runtime.mjs') return feat003Pattern.test(line);
    if (fixture !== 'test-feat-006-runtime.mjs') return false;
    const match = feat006Pattern.exec(line);
    return match !== null && feat006Stages.has(match[1]) && events.has(match[2]);
  });
}
