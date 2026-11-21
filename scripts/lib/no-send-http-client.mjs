import { Worker } from 'node:worker_threads';

const errorNames = new Set([
  'Error',
  'TypeError',
  'SyntaxError',
  'AssertionError',
  'AbortError',
  'TimeoutError',
]);

// A fetch pool cannot outlive its disposable container generation. No global
// dispatcher changes, retries, new dependencies or transport-option overrides.
export function createNoSendHttpClient(
  makeWorker = () =>
    new Worker(new URL('./no-send-http-worker.mjs', import.meta.url), {
      stdout: true,
      stderr: true,
      execArgv: [],
    }),
) {
  const worker = makeWorker();
  worker.stdout?.resume();
  worker.stderr?.resume();
  let pending;
  let closed = false;
  let termination;
  function fail(error) {
    const request = pending;
    pending = undefined;
    request?.reject(error);
  }
  worker.on('error', (error) => {
    closed = true;
    fail(error);
  });
  worker.on('messageerror', (error) => {
    closed = true;
    fail(error);
  });
  worker.on('exit', () => {
    closed = true;
    fail(new Error('Disposable HTTP worker exited.'));
  });
  worker.on('message', (message) => {
    if (!pending) return;
    if (message.type === 'observation') {
      try {
        pending.observe(...message.arguments);
      } catch (error) {
        closed = true;
        fail(error);
      }
      return;
    }
    const request = pending;
    pending = undefined;
    if (message.type === 'result') request.resolve(message.result);
    else if (
      message.type === 'error' &&
      (message.error instanceof Error || ['AbortError', 'TimeoutError'].includes(message.errorName))
    ) {
      // DOMException cloning differs from Error cloning. Preserve fixed names
      // explicitly and reconstruct those exceptions when their prototype is lost.
      // These values stay in memory; the existing diagnostic allowlist owns output.
      const error =
        message.error instanceof Error
          ? message.error
          : new DOMException(message.errorMessage, message.errorName);
      if (errorNames.has(message.errorName) && !(error instanceof DOMException))
        error.name = message.errorName;
      if (message.code !== undefined && !(error instanceof DOMException)) error.code = message.code;
      if (message.causeCode !== undefined && error.cause && typeof error.cause === 'object')
        error.cause.code = message.causeCode;
      request.reject(error);
    } else {
      closed = true;
      request.reject(new Error('Disposable HTTP worker protocol rejected.'));
    }
  });
  return {
    request(url, options = {}, observe = () => {}) {
      if (closed || pending)
        return Promise.reject(new Error('Disposable HTTP client unavailable.'));
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, observe };
        try {
          worker.postMessage({ url, options });
        } catch (error) {
          closed = true;
          fail(error);
        }
      });
    },
    close() {
      if (!termination) {
        closed = true;
        fail(new Error('Disposable HTTP client closed.'));
        // Resolves only after the worker exit event. Await before replacing servers.
        termination = Promise.resolve().then(() => worker.terminate());
      }
      return termination;
    },
  };
}
