import { createServer } from 'node:http';
import { instructorMfaRoutes } from './local-instructor-browser-routes.mjs';
import { buildPublicAssets } from './local-student-assets.mjs';
import { Readable } from 'node:stream';
import { createAuthBootstrapDependencies } from '../../supabase/functions/auth-bootstrap/runtime.ts';
import { createAuthBootstrapHandler } from '../../supabase/functions/auth-bootstrap/handler.ts';
import { createMemberAdministrationDependencies } from '../../supabase/functions/member-administration/runtime.ts';
import { createMemberAdministrationHandler } from '../../supabase/functions/member-administration/handler.ts';
import {
  studentOrigin,
  studentGateway,
  routeStudentRequest,
  studentResponseHeaders,
  gatewayOnlyFetch,
} from './local-student-router.mjs';

async function serve(assets, anon, { userId, service, limiter, instructorFactorId, mfaRole }) {
  // This private worker is the only process affected. Pin SDK calls as well as password login.
  globalThis.fetch = gatewayOnlyFetch(globalThis.fetch);
  const instructor =
    instructorFactorId === undefined
      ? undefined
      : instructorMfaRoutes(userId, instructorFactorId, fetch, mfaRole);
  const config = new Map(
    Object.entries({
      SUPABASE_URL: studentGateway,
      SUPABASE_ANON_KEY: anon,
      SUPABASE_SERVICE_ROLE_KEY: service,
      ALLOWED_ORIGIN: studentOrigin,
      FLYEYE_RUNTIME_PROFILE: 'local-synthetic-v1',
      FEAT005_DATA_CLASSIFICATION: 'synthetic-only',
      FEAT005_LIMITER_POLICY_VERSION: 'member-administration-subject-scope-v1',
      FEAT005_LIMITER_HMAC_SECRET: limiter,
    }),
  );
  const read = (name) => config.get(name);
  const handlers = {
    bootstrap: createAuthBootstrapHandler(createAuthBootstrapDependencies(read)),
    members: createMemberAdministrationHandler(await createMemberAdministrationDependencies(read)),
  };
  const active = new Set();
  async function dispatch(req, res) {
    try {
      const url = new URL(req.url, studentOrigin);
      if (
        req.socket.remoteAddress !== '127.0.0.1' ||
        req.headers.host !== url.host ||
        url.origin !== studentOrigin ||
        req.url !== url.pathname + url.search
      ) {
        res.writeHead(403).end();
        return;
      }
      const body = req.method === 'POST' ? Readable.toWeb(req) : undefined;
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body,
        duplex: 'half',
      });
      const response = await routeStudentRequest(request, {
        assets,
        anon,
        userId,
        instructor,
        handlers,
        passwordSignIn: fetch,
      });
      res.writeHead(response.status, studentResponseHeaders(response));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.destroy();
    }
  }
  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 }, (req, res) => {
    const operation = dispatch(req, res);
    active.add(operation);
    void operation.finally(() => active.delete(operation));
  });
  const origin = new URL(studentOrigin);
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(Number(origin.port), origin.hostname, resolve),
  );
  return async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await Promise.all(active);
    if (server.listening) throw new Error('Listener still open.');
  };
}

// A dedicated Linux child. Its first IPC message carries only the browser-safe key;
// Vite finishes before any operator-only credential is handed to this process.
if (!process.send || process.platform !== 'linux') throw new Error('Private fixture IPC required.');
const parentLost = () => process.exit(1);
process.once('disconnect', parentLost);
const receive = () => new Promise((resolve) => process.once('message', resolve));
try {
  const publicConfiguration = receive();
  process.send('online');
  const { anon } = await publicConfiguration;
  const assets = await buildPublicAssets(anon);
  const setup = receive();
  process.send('built');
  const close = await serve(assets, anon, await setup);
  const stop = receive();
  process.send('ready');
  if ((await stop) !== 'stop') throw new Error('Invalid control.');
  await close();
  process.off('disconnect', parentLost);
  process.send('closed', (error) => {
    process.disconnect();
    process.exitCode = error ? 1 : 0;
  });
} catch {
  // No upstream bodies, key material, sessions or exception details cross IPC.
  process.exit(1);
}
