import { gatewayLogDetails } from './onboarding-gateway-diagnostics.mjs';

// Classify each chunk transiently; retain only fixed categories, never log text.
// Signatures split across chunks can be missed. Absence is not evidence of health
// or attribution to a particular request. There are no extra reads or processes.
export function createBootstrapCliDiagnostics({ enabled, ci, githubActions }) {
  const allowed = enabled === true && ci === 'true' && githubActions === 'true';
  let active = false;
  let chunks = 0;
  let bytes = 0;
  let details = new Set();
  return {
    begin() {
      active = allowed;
      chunks = 0;
      bytes = 0;
      details = new Set();
    },
    observe(chunk) {
      if (!active) return;
      try {
        if (!Buffer.isBuffer(chunk)) {
          details.add('diagnostic-unavailable');
          return;
        }
        if (chunks >= 32 || bytes >= 256 * 1024) {
          details.add('cli-window-truncated');
          return;
        }
        const limit = Math.min(chunk.byteLength, 256 * 1024 - bytes);
        if (limit < chunk.byteLength) details.add('cli-window-truncated');
        chunks++;
        bytes += limit;
        for (const detail of gatewayLogDetails(chunk.subarray(0, limit).toString('utf8'))) {
          if (detail !== 'no-recognized-log-signature') details.add(detail);
        }
      } catch {
        details.add('diagnostic-unavailable');
      }
    },
    finish() {
      const result = !active
        ? ['diagnostic-unavailable']
        : [
            ...(chunks ? ['cli-output-observed'] : ['cli-output-not-observed']),
            ...(details.size ? details : ['no-recognized-log-signature']),
          ];
      active = false;
      details = new Set();
      return result;
    },
  };
}
