import { spawnSync } from 'node:child_process';

// Diagnostic hints only: never infer request success or retry from these categories.
export function gatewayResponseDetails(response, payload) {
  const details = [];
  if (/^kong\/[0-9.]+$/.test(response.headers.get('server') ?? '')) details.push('kong-response');
  const codes = {
    BOOT_ERROR: 'worker-boot-error',
    WORKER_ERROR: 'worker-error',
    WORKER_LIMIT: 'worker-limit',
  };
  if (typeof payload?.code === 'string' && Object.hasOwn(codes, payload.code)) {
    details.push(codes[payload.code]);
  }
  if (payload?.message === 'An invalid response was received from the upstream server')
    details.push('upstream-invalid-response');
  if (payload?.message === 'name resolution failed') details.push('proxy-name-resolution');
  return details.length ? details : ['unknown-server-response'];
}

export function gatewayLogDetails(output) {
  const patterns = [
    ['upstream-refused', /connect\(\) failed .*Connection refused/],
    [
      'upstream-reset',
      /(?:recv\(\) failed .*Connection reset by peer|upstream prematurely closed connection)/,
    ],
    ['upstream-timeout', /upstream timed out/],
    ['worker-boot-error', /(?:InvalidWorkerCreation|worker boot error)/],
    ['worker-error', /InvalidWorkerResponse/],
    ['worker-limit', /(?:WorkerRequestCancelled|CPU time limit exceeded|Memory limit exceeded)/],
    ['provider-panic', /(?:panic:|runtime error:)/],
    ['provider-error-log', /"level"\s*:\s*"error"/],
  ];
  const details = patterns.filter(([, pattern]) => pattern.test(output)).map(([detail]) => detail);
  return details.length ? details : ['no-recognized-log-signature'];
}

export function collectGatewayDiagnostics({
  projectId,
  since,
  ci,
  githubActions,
  services = ['kong', 'edge_runtime'],
  execute = spawnSync,
}) {
  if (
    ci !== 'true' ||
    githubActions !== 'true' ||
    !/^[a-z0-9_-]+$/.test(projectId) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(since) ||
    !Array.isArray(services) ||
    services.length > 2 ||
    services.some((service) => !['kong', 'edge_runtime', 'auth'].includes(service))
  )
    return [];
  const options = {
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 256 * 1024,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  return services.map((service) => {
    const stage =
      service === 'kong' ? 'gateway-log' : service === 'auth' ? 'provider-log' : 'worker-log';
    const container = `supabase_${service}_${projectId}`;
    try {
      const inspected = execute(
        'docker',
        ['inspect', '--type', 'container', '--format', '{{json .Config.Labels}}', container],
        options,
      );
      if (
        inspected.status !== 0 ||
        JSON.parse(inspected.stdout)?.['com.supabase.cli.project'] !== projectId
      ) {
        return { stage, details: ['diagnostic-unavailable'] };
      }
      const result = execute(
        'docker',
        ['logs', '--since', since, '--tail', '200', container],
        options,
      );
      return {
        stage,
        details:
          result.status === 0
            ? gatewayLogDetails(`${result.stdout}\n${result.stderr}`)
            : ['diagnostic-unavailable'],
      };
    } catch {
      // Diagnostics must not replace the original failure or expose Docker/provider output.
      return { stage, details: ['diagnostic-unavailable'] };
    }
  });
}
