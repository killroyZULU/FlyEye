import { fixtureDiagnostic } from './fixture-diagnostics.mjs';
import { transportDetail } from './provider-transport-diagnostics.mjs';

const statuses = new Set([400, 401, 403, 404, 405, 409, 422, 429, 500, 502, 503, 504]);

// Observe only the initial list check. Output must never replace its result/error.
export async function withInvitationListDiagnostics(
  operation,
  {
    enabled = process.env.FLYEYE_RUNTIME_DIAGNOSTICS === '1',
    write = (line) => process.stdout.write(`${line}\n`),
  } = {},
) {
  let current;
  const emit = (event, detail) => {
    try {
      const line = fixtureDiagnostic('FEAT-004', `invitation-list-${current}`, event, detail);
      if (enabled) write(line);
    } catch {
      // Diagnostic validation/output failures cannot alter fixture behavior.
    }
  };
  const stage = (next, status) => {
    if (current) emit('passed');
    current = next;
    emit('enter');
    if (next === 'decode') {
      const detail =
        status >= 200 && status < 300
          ? 'http-2xx'
          : statuses.has(status)
            ? `http-${status}`
            : 'http-other';
      emit('response', detail);
    }
  };
  stage('prepare');
  try {
    const result = await operation(stage);
    emit('passed');
    return result;
  } catch (error) {
    let detail = 'unclassified';
    try {
      if (current === 'transport' || current === 'decode') {
        detail =
          error?.name === 'SyntaxError' ? 'response-decoding-failed' : transportDetail(error);
      } else if (error?.name === 'AssertionError') {
        detail = 'assertion';
      }
    } catch {
      // Even unusual error objects retain their original identity.
    }
    emit('failed', detail);
    throw error;
  }
}
