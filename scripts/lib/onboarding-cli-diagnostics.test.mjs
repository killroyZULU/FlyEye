import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createBootstrapCliDiagnostics } from './onboarding-cli-diagnostics.mjs';
import { fixtureDiagnostic } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

const options = { enabled: true, ci: 'true', githubActions: 'true' };
const secret = 'synthetic-private-token-email-body';
describe('bounded bootstrap CLI observation', () => {
  it('uses both existing runtime pipe listeners without changing their drain bookkeeping', () => {
    const source = readFileSync('scripts/test-feat-003-runtime.mjs', 'utf8');
    const start = source.indexOf('  const suppressedOutput = [];');
    const end = source.indexOf('  await waitForEdgeRuntime();', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const observer = createBootstrapCliDiagnostics(options);
    const edgeProcess = { stdout: new EventEmitter(), stderr: new EventEmitter() };
    const sizes = new Function(
      'edgeProcess',
      'bootstrapCliDiagnostics',
      source.slice(start, end) + '\nreturn suppressedOutput;',
    )(edgeProcess, observer);
    edgeProcess.stdout.emit('data', Buffer.from('panic: before login'));
    observer.begin();
    edgeProcess.stdout.emit('data', Buffer.from('InvalidWorkerResponse'));
    edgeProcess.stderr.emit('data', Buffer.from('InvalidWorkerCreation'));
    expect(observer.finish()).toEqual(['cli-output-observed', 'worker-error', 'worker-boot-error']);
    for (let index = 0; index < 40; index++) edgeProcess.stdout.emit('data', Buffer.from(secret));
    expect(sizes).toHaveLength(32);
    expect(sizes.every((size) => Number.isInteger(size))).toBe(true);
    expect(edgeProcess.stdout.listenerCount('data')).toBe(1);
    expect(edgeProcess.stderr.listenerCount('data')).toBe(1);
  });
  it('retains only categories inside each window and drains no stream itself', () => {
    const observer = createBootstrapCliDiagnostics(options);
    observer.observe(Buffer.from('worker boot error'));
    observer.begin();
    observer.observe(Buffer.from(`${secret} InvalidWorkerResponse`));
    observer.observe(Buffer.from(`${secret} InvalidWorkerResponse`));
    const result = observer.finish();
    expect(result).toEqual(['cli-output-observed', 'worker-error']);
    const lines = result.map((detail) =>
      fixtureDiagnostic('FEAT-003', 'bootstrap-cli-log', 'response', detail),
    );
    expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', lines.join('\n'))).toEqual(lines);
    expect(JSON.stringify(observer)).not.toContain(secret);
    observer.observe(Buffer.from('panic: private'));
    observer.begin();
    expect(observer.finish()).toEqual(['cli-output-not-observed', 'no-recognized-log-signature']);
    expect(observer.finish()).toEqual(['diagnostic-unavailable']);
  });
  it.each([{ enabled: false }, { ci: 'false' }, { githubActions: 'false' }])(
    'is inert outside the approved fixture (%j)',
    (override) => {
      const observer = createBootstrapCliDiagnostics({ ...options, ...override });
      observer.begin();
      observer.observe(Buffer.from('worker boot error'));
      expect(observer.finish()).toEqual(['diagnostic-unavailable']);
    },
  );
  it('marks the chunk cap without inspecting any later text', () => {
    const observer = createBootstrapCliDiagnostics(options);
    observer.begin();
    for (let index = 0; index < 32; index++) observer.observe(Buffer.from(secret));
    observer.observe(Buffer.from('worker boot error'));
    expect(observer.finish()).toEqual(['cli-output-observed', 'cli-window-truncated']);
  });
  it('marks the byte cap and does not parse text beyond it', () => {
    const observer = createBootstrapCliDiagnostics(options);
    observer.begin();
    observer.observe(Buffer.from('x'.repeat(256 * 1024) + 'worker boot error'));
    observer.observe(Buffer.from('panic: private'));
    expect(observer.finish()).toEqual(['cli-output-observed', 'cli-window-truncated']);
  });
  it('does not pretend split or unrecognized output establishes a cause', () => {
    const observer = createBootstrapCliDiagnostics(options);
    observer.begin();
    observer.observe(Buffer.from('InvalidWorker'));
    observer.observe(Buffer.from('Creation'));
    expect(observer.finish()).toEqual(['cli-output-observed', 'no-recognized-log-signature']);
  });
  it('makes unreadable observations explicit without leaking the input', () => {
    const observer = createBootstrapCliDiagnostics(options);
    observer.begin();
    observer.observe(secret);
    expect(observer.finish()).toEqual(['cli-output-not-observed', 'diagnostic-unavailable']);
  });
});
