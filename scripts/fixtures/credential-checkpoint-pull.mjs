import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { proofStorageImage } from './credential-proof-storage.mjs';

// The result can contain registry details or paths. Only a fixed category leaves this boundary.
export function storagePullResult(result) {
  if (!result.error && !result.signal && result.status === 0) return 'passed';
  if (result.error || result.signal) return 'process-error';
  const detail = result.stderr ?? '';
  if (/no space left on device/i.test(detail)) return 'disk-full';
  if (/toomanyrequests|too many requests/i.test(detail)) return 'rate-limited';
  if (/manifest unknown|no matching manifest/i.test(detail)) return 'manifest-unavailable';
  if (/unauthorized|access denied|forbidden/i.test(detail)) return 'registry-denial';
  if (/no such host|connection reset|i\/o timeout|tls handshake timeout/i.test(detail))
    return 'connection-error';
  return 'unknown';
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = spawnSync('docker', ['pull', '--quiet', proofStorageImage], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
    maxBuffer: 65536,
    timeout: 180000,
  });
  const category = storagePullResult(result);
  const exit = result.status;
  console.log(`Pinned local Storage image pull: ${category}; exit=${exit ?? 'unavailable'}.`);
  if (category !== 'passed') process.exitCode = exit || 1;
}
