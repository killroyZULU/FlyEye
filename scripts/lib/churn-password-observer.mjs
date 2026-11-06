import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';
import { fixtureDiagnostic } from './fixture-diagnostics.mjs';
import { collectGatewayDiagnostics } from './onboarding-gateway-diagnostics.mjs';
import { isPasswordLogin } from './provider-transport-diagnostics.mjs';

const empty = { observe: (operation) => operation(), dispose() {} };
const object = (value) => value !== null && typeof value === 'object';
const counters = (socket) =>
  Number.isSafeInteger(socket?.bytesWritten) &&
  socket.bytesWritten >= 0 &&
  Number.isSafeInteger(socket?.bytesRead) &&
  socket.bytesRead >= 0;
const interval = (elapsed) =>
  elapsed < 0 || !Number.isFinite(elapsed)
    ? 'password-idle-unknown'
    : elapsed < 1000
      ? 'password-idle-under-second'
      : elapsed < 5000
        ? 'password-idle-under-five-seconds'
        : 'password-idle-five-seconds-or-more';

// Fixture-only. Never inspect headers/bodies or change sockets/dispatchers.
export function createChurnPasswordObserver({
  apiUrl,
  projectId,
  mode,
  enabled,
  ci = process.env.CI,
  githubActions = process.env.GITHUB_ACTIONS,
  report,
  collect = collectGatewayDiagnostics,
  getChannel = channel,
  now = () => performance.now(),
}) {
  if (
    !enabled ||
    ci !== 'true' ||
    githubActions !== 'true' ||
    !['churn-cleanup-probe', 'factor-churn'].includes(mode)
  )
    return empty;
  let origin;
  try {
    const api = new URL(apiUrl);
    if (
      api.pathname !== '/' ||
      api.search ||
      api.hash ||
      api.username ||
      api.password ||
      !isPasswordLogin(new URL('/auth/v1/token?grant_type=password', api), 'POST', apiUrl)
    )
      return empty;
    origin = api.origin;
  } catch {
    return empty;
  }

  const context = new AsyncLocalStorage();
  let requests = new WeakMap();
  let connected = new WeakSet();
  let completed = new WeakMap();
  const subscriptions = [];
  let active;
  let disposed = false;
  let unavailable = false;
  const emit = (stage, detail) => {
    try {
      fixtureDiagnostic('FEAT-003', stage, 'response', detail);
      report(stage, 'response', detail);
    } catch {
      /* Diagnostics cannot replace the original result. */
    }
  };
  function dispose() {
    disposed = true;
    for (const [ch, listener] of subscriptions) {
      try {
        ch.unsubscribe(listener);
      } catch {
        /* Never prevent fixture cleanup. */
      }
    }
    subscriptions.length = 0;
    requests = new WeakMap();
    connected = new WeakSet();
    completed = new WeakMap();
    if (active) active.ambiguous = true;
    context.disable();
  }
  const handlers = {
    'client:connected': ({ socket, connectParams }) => {
      // Only connection identity; no request or connection values are retained/emitted.
      const url = new URL(`${connectParams.protocol}//${connectParams.host}`);
      if (url.origin === origin && object(socket)) connected.add(socket);
    },
    'request:create': ({ request }) => {
      const record = context.getStore();
      if (!record || record !== active) return;
      if (
        !object(request) ||
        String(request.origin) !== origin ||
        !isPasswordLogin(origin + request.path, request.method, origin)
      ) {
        // A redirected/nonmatching request cannot inherit the password observation.
        record.ambiguous = true;
        return;
      }
      if (record.seen) record.ambiguous = true;
      record.seen = true;
      requests.set(request, record);
    },
    'client:sendHeaders': ({ request, socket }) => {
      const record = requests.get(request);
      if (!record) return;
      if (record.dispatched || !object(socket)) {
        record.ambiguous = true;
        return;
      }
      record.dispatched = true;
      record.socket = socket;
      if (!counters(socket)) return;
      const previous = completed.get(socket);
      // Any intervening/unobserved traffic makes reuse and its interval unknown.
      if (
        previous &&
        previous.written === socket.bytesWritten &&
        previous.read === socket.bytesRead
      ) {
        record.socketKind = 'password-socket-reused';
        record.idle = interval(now() - previous.at);
      } else if (connected.has(socket) && socket.bytesWritten === 0) {
        record.socketKind = 'password-socket-new';
      }
      completed.delete(socket);
    },
    'request:headers': ({ request }) => {
      const record = requests.get(request);
      if (record) {
        if (!record.dispatched || record.headers) record.ambiguous = true;
        record.headers = true;
      }
    },
    'request:trailers': ({ request }) => {
      const record = requests.get(request);
      if (!record) return;
      if (!record.ambiguous && record.dispatched && record.headers && counters(record.socket)) {
        completed.set(record.socket, {
          at: now(),
          written: record.socket.bytesWritten,
          read: record.socket.bytesRead,
        });
      }
      requests.delete(request);
    },
    'request:error': ({ request }) => {
      const record = requests.get(request);
      if (!record) return;
      if (object(record.socket)) completed.delete(record.socket);
      requests.delete(request);
    },
  };
  try {
    for (const [name, handler] of Object.entries(handlers)) {
      const ch = getChannel(`undici:${name}`);
      const listener = (message) => {
        if (disposed) return;
        try {
          handler(message);
        } catch {
          if (active) active.ambiguous = true;
        }
      };
      ch.subscribe(listener);
      subscriptions.push([ch, listener]);
    }
  } catch {
    dispose();
    disposed = false;
    unavailable = true;
  }

  function failure(record) {
    const unknown = disposed || unavailable || record.ambiguous || !record.seen;
    emit('password-connection', unknown ? 'password-socket-unknown' : record.socketKind);
    emit(
      'password-connection',
      !unknown && record.dispatched ? 'password-dispatch-observed' : 'password-dispatch-unknown',
    );
    emit(
      'password-connection',
      !unknown && record.headers
        ? 'password-response-headers-observed'
        : 'password-response-headers-unknown',
    );
    emit('password-connection', unknown ? 'password-idle-unknown' : record.idle);
    let evidence;
    try {
      evidence = collect({
        projectId,
        since: record.since,
        ci,
        githubActions,
        services: ['kong', 'auth'],
      });
    } catch {
      /* Report missing evidence without exposing the exception. */
    }
    for (const stage of ['gateway-log', 'provider-log']) {
      const details = evidence?.find((entry) => entry.stage === stage)?.details;
      for (const detail of Array.isArray(details) && details.length
        ? details.slice(0, 8)
        : ['diagnostic-unavailable'])
        emit(stage, detail);
    }
  }
  return {
    async observe(operation, { input, method }) {
      if (disposed || !isPasswordLogin(input, method, origin)) return operation();
      const overlapping = Boolean(active);
      if (active) active.ambiguous = true;
      const record = {
        since: new Date().toISOString(),
        socketKind: 'password-socket-unknown',
        idle: 'password-idle-unknown',
        ambiguous: overlapping,
      };
      if (!overlapping) active = record;
      // Concurrent calls are never attributed to the active observation.
      try {
        return await context.run(overlapping ? undefined : record, operation);
      } catch (error) {
        try {
          failure(record);
        } catch {
          /* Preserve the exact original error. */
        }
        throw error;
      } finally {
        if (!overlapping) active = undefined;
      }
    },
    dispose,
  };
}
