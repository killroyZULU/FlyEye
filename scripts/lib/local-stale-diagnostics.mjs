// Compare every mount field and preserve duplicates; only array order is irrelevant.
export function orderedMounts(mounts) {
  if (!Array.isArray(mounts)) throw new Error('Mount inventory unavailable.');
  return [...mounts].sort((left, right) => {
    const a = JSON.stringify(left),
      b = JSON.stringify(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

// Fixed vocabulary follows the no-send command diagnostics. These are textual
// observations, not proof of root cause. No raw output or error message escapes.
const patterns = [
  ['configuration', /invalid config|unknown key|unrecognized key|failed to parse/i],
  ['migration', /error.*migration|failed.*migration|SQLSTATE/i],
  ['image', /failed to pull|pull access denied|manifest unknown/i],
  ['health', /unhealthy|health check|healthcheck/i],
  ['network', /network.*not found|network.*error|connection refused/i],
  ['port', /port is already allocated|address already in use/i],
  ['timeout', /timed out|timeout/i],
  ['guard', /FlyEye disposable binding target rejected/],
];
const fixed = (value, allowed) =>
  value == null ? 'none' : allowed.includes(value) ? value : 'unknown';

export function startupFailureDiagnostic(result) {
  const value = result ?? {};
  const streams = [value.stdout, value.stderr];
  const present = streams.filter((stream) => stream != null);
  const readable = present.every((stream) => typeof stream === 'string');
  const oversized = readable && present.some((stream) => Buffer.byteLength(stream) > 32768);
  const output = !present.length
    ? 'missing'
    : !readable
      ? 'unreadable'
      : oversized
        ? 'oversize'
        : present.every((stream) => stream.length === 0)
          ? 'empty'
          : 'available';
  const matches =
    output === 'available'
      ? patterns.filter(([, pattern]) => present.some((stream) => pattern.test(stream)))
      : [];
  return Object.freeze({
    exitCode:
      Number.isInteger(value.status) && value.status >= 0 && value.status <= 255
        ? value.status
        : 'unknown',
    signal:
      result == null
        ? 'unknown'
        : fixed(value.signal, ['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT']),
    error:
      result == null
        ? 'unknown'
        : value.error == null
          ? 'none'
          : ['ETIMEDOUT', 'ENOBUFS', 'ENOENT', 'EACCES'].includes(value.error.code)
            ? value.error.code
            : 'unknown',
    output,
    category: matches.length > 1 ? 'ambiguous' : (matches[0]?.[0] ?? 'unknown'),
  });
}
