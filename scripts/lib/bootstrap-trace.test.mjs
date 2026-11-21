// @vitest-environment node
import { createHmac, webcrypto } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  bootstrapDockerPath,
  bootstrapTraceCapture,
  prepareBootstrapTrace,
} from './bootstrap-trace.mjs';
import { traceBootstrapHandler } from './bootstrap-trace-worker.mjs';
import { observeOnboardingLogin } from './onboarding-login-diagnostics.mjs';
import { reportBootstrapFailure } from './onboarding-bootstrap-diagnostics.mjs';
import { fixtureDiagnostic } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

const key = 'a'.repeat(64);
const api = 'http://127.0.0.1:54321';
const origin = 'http://127.0.0.1:4173';
const authorization = 'Bearer synthetic-private-input';
const digest = createHmac('sha256', key).update(authorization).digest('hex');
const frame = (event, tag = digest) => `FLYEYE_BOOTSTRAP_TRACE_V1 ${tag} ${event}\n`;
const browserRequest = (url = `${api}/functions/v1/auth-bootstrap`) => ({
  url: () => url,
  method: () => 'POST',
  headers: () => ({ authorization }),
  postDataJSON: () => {
    throw new Error('No body reads');
  },
});
const workerRequest = () =>
  new Request(`${api}/auth-bootstrap`, {
    method: 'POST',
    headers: { origin, authorization },
    body: '{}',
  });
function setupCapture() {
  const capture = bootstrapTraceCapture(key, api);
  capture.begin();
  capture.request(browserRequest());
  return capture;
}
function observed(handler, overrides = {}) {
  const lines = [];
  let complete;
  const done = new Promise((resolve) => {
    complete = resolve;
  });
  return {
    lines,
    done,
    handler: traceBootstrapHandler(handler, {
      key,
      origin,
      crypto: webcrypto,
      emit: (line) => {
        lines.push(line);
        if (lines.length === 2) complete();
      },
      ...overrides,
    }),
  };
}

describe('passive worker bootstrap trace', () => {
  it.each([200, 401, 409, 500, 503])(
    'preserves the original promise, request and response for %s',
    async (status) => {
      const request = workerRequest();
      const response = new Response('synthetic-private-body', { status });
      const promise = Promise.resolve(response);
      const original = vi.fn(() => promise);
      const trace = observed(original);
      expect(trace.handler(request)).toBe(promise);
      expect(original).toHaveBeenCalledExactlyOnceWith(request);
      expect(await promise).toBe(response);
      await trace.done;
      expect(request.bodyUsed).toBe(false);
      expect(response.bodyUsed).toBe(false);
      expect(trace.lines).toEqual([
        frame('entry').trim(),
        frame(status === 503 ? 'returned-503' : 'returned-non503').trim(),
      ]);
      const capture = setupCapture();
      trace.lines.forEach((line) => capture.capture(`${line}\n`, 'stderr'));
      expect(capture.finish()).toBe(
        status === 503 ? 'bootstrap-trace-handler-503' : 'bootstrap-trace-handler-non503',
      );
    },
  );
  it('preserves synchronous values and thrown error identity', async () => {
    const response = new Response(null, { status: 503 });
    const success = observed(() => response);
    expect(success.handler(workerRequest())).toBe(response);
    await success.done;
    const error = new Error('private-error');
    const failure = observed(() => {
      throw error;
    });
    expect(() => failure.handler(workerRequest())).toThrow(error);
    await failure.done;
    expect(failure.lines[1]).toBe(frame('threw').trim());
    expect(failure.lines.join()).not.toContain(error.message);
  });
  it('preserves a rejected original promise', async () => {
    const error = new Error('private-rejection');
    const promise = Promise.reject(error);
    const trace = observed(() => promise);
    expect(trace.handler(workerRequest())).toBe(promise);
    await expect(promise).rejects.toBe(error);
    await trace.done;
    expect(trace.lines[1]).toBe(frame('threw').trim());
  });
  it('does not await a stalled observer, read bodies, schedule timers or issue requests', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      const promise = Promise.resolve(new Response(null));
      const crypto = { subtle: { importKey: () => new Promise(() => {}) } };
      expect(observed(() => promise, { crypto }).handler(workerRequest())).toBe(promise);
      expect(fetch).not.toHaveBeenCalled();
      expect(timer).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
      timer.mockRestore();
    }
  });
  it.each([
    {
      crypto: {
        subtle: {
          importKey: () => {
            throw new Error('private');
          },
        },
      },
    },
    { crypto: { subtle: { importKey: () => Promise.reject(new Error('private')) } } },
    {
      emit: () => {
        throw new Error('private');
      },
    },
  ])('suppresses observation errors without replacing the result', async (overrides) => {
    const result = new Response(null, { status: 503 });
    const trace = observed(() => result, overrides);
    expect(trace.handler(workerRequest())).toBe(result);
    await new Promise((resolve) => setImmediate(resolve));
  });
  it('leaves disabled tracing and unrelated methods/origins/paths unobserved', async () => {
    const original = vi.fn(() => new Response(null));
    expect(traceBootstrapHandler(original, { key: '', origin })).toBe(original);
    const trace = observed(original);
    for (const request of [
      new Request(`${api}/auth-bootstrap`),
      new Request(`${api}/auth-bootstrap`, {
        method: 'POST',
        headers: { origin: 'https://other.invalid', authorization },
      }),
      new Request(`${api}/other`, { method: 'POST', headers: { origin, authorization } }),
    ])
      trace.handler(request);
    await new Promise((resolve) => setImmediate(resolve));
    expect(trace.lines).toEqual([]);
    expect(original).toHaveBeenCalledTimes(3);
  });
});

describe('bounded private capture', () => {
  it('rejects reused correlation across windows even when delayed frames look complete', () => {
    const capture = setupCapture();
    expect(capture.finish()).toBe('bootstrap-trace-unknown');
    capture.begin();
    capture.request(browserRequest());
    capture.capture(frame('entry') + frame('returned-503'), 'stderr');
    expect(capture.finish()).toBe('bootstrap-trace-unknown');
  });
  it('accepts chunk-split frames and never publishes correlation material', () => {
    const capture = setupCapture();
    const value = `[worker] ${frame('entry')}${frame('returned-503')}`;
    for (const chunk of [value.slice(0, 11), value.slice(11, 90), value.slice(90)])
      capture.capture(Buffer.from(chunk), 'stderr');
    const detail = capture.finish();
    expect(detail).toBe('bootstrap-trace-handler-503');
    const line = fixtureDiagnostic('FEAT-003', 'bootstrap-trace', 'response', detail);
    expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', line)).toContain(line);
    for (const secret of [key, authorization, digest, 'FLYEYE_BOOTSTRAP_TRACE_V1'])
      expect(line).not.toContain(secret);
    expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', value)).toEqual([]);
  });
  it.each([
    'missing',
    'entry-only',
    'duplicate',
    'wrong-tag',
    'multiple-requests',
    'overflow',
    'invalid',
    'partial',
    'reversed',
    'capture-error',
  ])('returns unknown for %s evidence', (scenario) => {
    const capture = setupCapture();
    if (scenario === 'entry-only') capture.capture(frame('entry'), 'stderr');
    if (scenario === 'duplicate')
      capture.capture(frame('entry') + frame('entry') + frame('returned-503'), 'stderr');
    if (scenario === 'wrong-tag')
      capture.capture(
        frame('entry', 'b'.repeat(64)) + frame('returned-503', 'b'.repeat(64)),
        'stderr',
      );
    if (scenario === 'multiple-requests') {
      capture.request(browserRequest());
      capture.capture(frame('entry') + frame('returned-503'), 'stderr');
    }
    if (scenario === 'overflow') {
      capture.capture('x'.repeat(65537), 'stderr');
      capture.capture(frame('entry') + frame('returned-503'), 'stderr');
    }
    if (scenario === 'invalid')
      capture.capture(frame('entry') + frame('private-response'), 'stderr');
    if (scenario === 'partial')
      capture.capture(frame('entry') + frame('returned-503') + 'FLYEYE_', 'stderr');
    if (scenario === 'reversed') capture.capture(frame('returned-503') + frame('entry'), 'stderr');
    if (scenario === 'capture-error') capture.capture({}, 'stderr');
    expect(capture.finish()).toBe('bootstrap-trace-unknown');
  });
  it('does not correlate cross-origin requests or retain successful/previous windows', () => {
    const capture = bootstrapTraceCapture(key, api);
    capture.capture(frame('entry'), 'stderr');
    capture.begin();
    capture.request(browserRequest('https://other.invalid/functions/v1/auth-bootstrap'));
    capture.capture(frame('entry') + frame('returned-503'), 'stderr');
    expect(capture.finish()).toBe('bootstrap-trace-unknown');
    capture.begin();
    capture.request(browserRequest());
    expect(capture.finish()).toBe('bootstrap-trace-unknown');
    capture.dispose();
    expect(capture.finish()).toBe('bootstrap-trace-unknown');
    expect(() => bootstrapTraceCapture(key, 'https://remote.invalid')).toThrow('rejected');
  });
  it('allows only fixed trace categories through the existing sanitizer', () => {
    for (const detail of [
      'bootstrap-trace-handler-503',
      'bootstrap-trace-handler-non503',
      'bootstrap-trace-handler-threw',
      'bootstrap-trace-unknown',
    ]) {
      expect(fixtureDiagnostic('FEAT-003', 'bootstrap-trace', 'response', detail)).toContain(
        detail,
      );
    }
    expect(() => fixtureDiagnostic('FEAT-003', 'bootstrap-trace', 'response', digest)).toThrow();
    expect(() =>
      fixtureDiagnostic('FEAT-004', 'bootstrap-trace', 'response', 'bootstrap-trace-handler-503'),
    ).toThrow();
  });
  it('wires the existing browser observer to capture without adding listeners or requests', () => {
    const page = new EventEmitter();
    const capture = bootstrapTraceCapture(key, api);
    const observer = observeOnboardingLogin(page, vi.fn(), api, capture);
    observer.begin();
    page.emit('request', browserRequest());
    capture.capture(frame('entry') + frame('returned-503'), 'stderr');
    expect(observer.finish().traceDetail).toBe('bootstrap-trace-handler-503');
    observer.dispose();
    expect(page.eventNames()).toEqual([]);
  });
  it('reports only on the existing CI failure path and keeps injected values private', async () => {
    const report = vi.fn();
    const collect = () => [];
    await reportBootstrapFailure({
      report,
      collect,
      traceDetail: digest,
      ci: 'true',
      githubActions: 'true',
    });
    expect(report.mock.calls.flat()).not.toContain(digest);
    report.mockClear();
    await reportBootstrapFailure({
      report,
      collect,
      traceDetail: 'bootstrap-trace-handler-503',
      ci: 'true',
      githubActions: 'true',
    });
    expect(report).toHaveBeenCalledWith(
      'bootstrap-trace',
      'response',
      'bootstrap-trace-handler-503',
    );
    report.mockClear();
    await reportBootstrapFailure({
      report,
      collect,
      traceDetail: 'bootstrap-trace-handler-503',
      ci: 'false',
      githubActions: 'true',
    });
    expect(report).not.toHaveBeenCalled();
  });
});

describe('scoped disposable import substitution', () => {
  function files() {
    const owned = mkdtempSync(path.join(tmpdir(), 'flyeye-feat003-trace-test-'));
    onTestFinished(() => {
      expect(path.dirname(owned)).toBe(tmpdir());
      rmSync(owned, { recursive: true, force: true });
    });
    const root = path.join(owned, 'source');
    const functions = path.join(root, 'supabase/functions');
    mkdirSync(path.join(functions, 'auth-bootstrap'), { recursive: true });
    writeFileSync(
      path.join(root, 'supabase/config.toml'),
      '[functions.auth-bootstrap]\nverify_jwt = true\n',
    );
    writeFileSync(
      path.join(functions, 'deno.json'),
      JSON.stringify({
        imports: {
          '@supabase/supabase-js': 'npm:@supabase/supabase-js@2.110.7',
          zod: 'npm:zod@4.6.6',
        },
      }),
    );
    return { owned, root, functions, options: { directory: owned, root, apiUrl: api, origin } };
  }
  it('changes only the bootstrap entrypoint import and returns the actual generated factory result', async () => {
    const { options, functions } = files();
    const before = readFileSync(path.join(functions, 'deno.json'), 'utf8');
    const result = prepareBootstrapTrace(options);
    const map = JSON.parse(readFileSync(result.args[1], 'utf8'));
    expect(map.imports).toEqual(JSON.parse(before).imports);
    const [scope, mapping] = Object.entries(map.scopes)[0];
    expect(Object.keys(map.scopes)).toHaveLength(1);
    expect(scope).toMatch(/\/auth-bootstrap\/index\.ts$/);
    expect(scope).not.toMatch(/file:\/\/\/[A-Za-z]:/);
    expect(Object.keys(mapping)).toEqual([scope.replace(/index\.ts$/, 'handler.ts')]);
    const wrapper = path.join(options.directory, 'bootstrap-trace.mjs');
    expect(Object.values(mapping)).toEqual([bootstrapDockerPath(wrapper)]);
    const source = readFileSync(wrapper, 'utf8');
    expect(source).toContain(`from ${JSON.stringify(Object.keys(mapping)[0])}`);
    expect(source).not.toContain(result.environment.split('=')[1].trim());
    expect(readFileSync(path.join(functions, 'deno.json'), 'utf8')).toBe(before);
    const response = new Response(null);
    const promise = Promise.resolve(response);
    const handler = vi.fn(() => promise);
    const original = vi.fn(() => handler);
    // Execute the generated factory, substituting only the container-only import and Deno env.
    const factory = new Function(
      'original',
      'Deno',
      source
        .replace(/^import .*;\n/, '')
        .replace(
          'export function createAuthBootstrapHandler',
          'return function createAuthBootstrapHandler',
        ),
    )(original, { env: { get: () => undefined } });
    const dependencies = { allowedOrigin: origin };
    expect(factory(dependencies)(workerRequest())).toBe(promise);
    expect(original).toHaveBeenCalledExactlyOnceWith(dependencies);
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it.each([
    'per-function-map',
    'config-entrypoint',
    'changed-import',
    'remote',
    'unowned',
    'collision',
  ])('rejects unexpected setup: %s', (scenario) => {
    const { options, functions, root } = files();
    if (scenario === 'per-function-map')
      writeFileSync(path.join(functions, 'auth-bootstrap/deno.json'), '{}');
    if (scenario === 'config-entrypoint')
      writeFileSync(path.join(root, 'supabase/config.toml'), 'entrypoint = "other.ts"');
    if (scenario === 'changed-import') writeFileSync(path.join(functions, 'deno.json'), '{}');
    if (scenario === 'remote') options.apiUrl = 'https://remote.invalid';
    if (scenario === 'unowned') options.directory = root;
    if (scenario === 'collision')
      writeFileSync(path.join(options.directory, 'bootstrap-trace.mjs'), 'preserve me');
    expect(() => prepareBootstrapTrace(options)).toThrow(
      'Bootstrap fixture trace preparation rejected.',
    );
    if (scenario === 'collision')
      expect(readFileSync(path.join(options.directory, 'bootstrap-trace.mjs'), 'utf8')).toBe(
        'preserve me',
      );
  });
  it('maps Windows and Linux mounts without changing path text', () => {
    expect(bootstrapDockerPath('C:\\Users\\Synthetic Person\\handler.ts')).toBe(
      '/Users/Synthetic Person/handler.ts',
    );
    expect(bootstrapDockerPath('/home/synthetic/handler.ts')).toBe('/home/synthetic/handler.ts');
  });
});
