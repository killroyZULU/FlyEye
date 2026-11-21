import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { traceBootstrapHandler } from './bootstrap-trace-worker.mjs';

const rejection = 'Bootstrap fixture trace preparation rejected.';
const prefix = 'FLYEYE_BOOTSTRAP_TRACE_V1 ';
const loopback = (value) => {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error(rejection);
  return url.origin;
};

export function bootstrapTraceCapture(key, apiUrl) {
  const apiOrigin = loopback(apiUrl);
  const seen = new Set();
  let active = false;
  let expected;
  let requests;
  let records;
  let buffers;
  let bytes;
  let uncertain;
  const reset = () => {
    expected = undefined;
    requests = 0;
    records = [];
    buffers = { stdout: '', stderr: '' };
    bytes = 0;
    uncertain = false;
  };
  reset();
  return {
    begin() {
      reset();
      active = true;
    },
    request(request) {
      if (!active) return;
      try {
        const url = new URL(request.url());
        if (
          url.origin !== apiOrigin ||
          url.pathname !== '/functions/v1/auth-bootstrap' ||
          request.method() !== 'POST'
        )
          return;
        requests++;
        const authorization = request.headers().authorization;
        if (requests !== 1 || typeof authorization !== 'string' || !authorization) {
          uncertain = true;
          return;
        }
        expected = createHmac('sha256', key).update(authorization).digest('hex');
        // A reused bearer cannot distinguish delayed frames from an earlier window.
        if (seen.has(expected) || seen.size >= 32) uncertain = true;
        else seen.add(expected);
      } catch {
        uncertain = true;
      }
    },
    capture(chunk, stream) {
      if (!active) return;
      try {
        if (!Object.hasOwn(buffers, stream) || (bytes += Buffer.byteLength(chunk)) > 65536) {
          uncertain = true;
          return;
        }
        buffers[stream] += chunk.toString('utf8');
        const lines = buffers[stream].split('\n');
        buffers[stream] = lines.pop();
        if (buffers[stream].length > 2048) {
          uncertain = true;
          buffers[stream] = '';
        }
        for (const line of lines) {
          const offset = line.indexOf(prefix);
          if (offset < 0) continue;
          const frame = line.slice(offset).trim();
          const match =
            /^FLYEYE_BOOTSTRAP_TRACE_V1 ([a-f0-9]{64}) (entry|returned-503|returned-non503|threw|unknown)$/.exec(
              frame,
            );
          if (!match || records.length >= 64) {
            uncertain = true;
            continue;
          }
          records.push({ tag: match[1], event: match[2] });
        }
      } catch {
        uncertain = true;
      }
    },
    finish() {
      if (!active) return 'bootstrap-trace-unknown';
      active = false;
      let result = 'bootstrap-trace-unknown';
      const matched = records
        .filter((record) => record.tag === expected)
        .map((record) => record.event);
      if (
        !uncertain &&
        requests === 1 &&
        expected &&
        !Object.values(buffers).some((buffer) => buffer.trim())
      ) {
        if (matched.length === 2 && matched[0] === 'entry') {
          result =
            {
              'returned-503': 'bootstrap-trace-handler-503',
              'returned-non503': 'bootstrap-trace-handler-non503',
              threw: 'bootstrap-trace-handler-threw',
            }[matched[1]] ?? result;
        }
      }
      reset();
      return result;
    },
    dispose() {
      active = false;
      reset();
      key = undefined;
      seen.clear();
    },
  };
}

// The pinned CLI strips the Windows drive when mounting host files in its worker.
export const bootstrapDockerPath = (value) => value.replace(/^[A-Za-z]:/, '').replaceAll('\\', '/');

export function prepareBootstrapTrace({ directory, root, apiUrl, origin }) {
  try {
    loopback(apiUrl);
    loopback(origin);
    const owned = realpathSync(directory);
    if (
      path.dirname(owned) !== realpathSync(tmpdir()) ||
      !path.basename(owned).startsWith('flyeye-feat003-')
    )
      throw new Error(rejection);
    const functions = path.join(root, 'supabase/functions');
    const config = readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
    if (/\b(?:import_map|entrypoint)\s*=/.test(config)) throw new Error(rejection);
    const imports = JSON.parse(readFileSync(path.join(functions, 'deno.json'), 'utf8'));
    if (
      JSON.stringify(imports) !==
      JSON.stringify({
        imports: {
          '@supabase/supabase-js': 'npm:@supabase/supabase-js@2.110.7',
          zod: 'npm:zod@4.6.6',
        },
      })
    )
      throw new Error(rejection);
    for (const entry of readdirSync(functions, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (
        ['deno.json', 'deno.jsonc', 'import_map.json'].some((name) =>
          existsSync(path.join(functions, entry.name, name)),
        )
      )
        throw new Error(rejection);
    }
    const index = bootstrapDockerPath(path.resolve(functions, 'auth-bootstrap/index.ts'));
    const handler = bootstrapDockerPath(path.resolve(functions, 'auth-bootstrap/handler.ts'));
    const wrapper = path.join(owned, 'bootstrap-trace.mjs');
    const map = path.join(owned, 'bootstrap-import-map.json');
    const key = randomBytes(32).toString('hex');
    const worker =
      `import { createAuthBootstrapHandler as original } from ${JSON.stringify(pathToFileURL(handler, { windows: false }).href)};\n` +
      `${traceBootstrapHandler.toString()}\n` +
      `export function createAuthBootstrapHandler(dependencies) {\n` +
      ` return traceBootstrapHandler(original(dependencies), {\n` +
      ` key: Deno.env.get('FEAT003_BOOTSTRAP_TRACE_KEY'), origin: dependencies.allowedOrigin,\n` +
      ` crypto: globalThis.crypto, emit: (line) => console.error(line) });\n}\n`;
    writeFileSync(wrapper, worker, { flag: 'wx', mode: 0o600 });
    writeFileSync(
      map,
      JSON.stringify({
        ...imports,
        scopes: {
          [pathToFileURL(index, { windows: false }).href]: {
            [pathToFileURL(handler, { windows: false }).href]: bootstrapDockerPath(wrapper),
          },
        },
      }),
      { flag: 'wx', mode: 0o600 },
    );
    return {
      args: ['--import-map', map],
      environment: `FEAT003_BOOTSTRAP_TRACE_KEY=${key}\n`,
      capture: bootstrapTraceCapture(key, apiUrl),
    };
  } catch {
    throw new Error(rejection);
  }
}
