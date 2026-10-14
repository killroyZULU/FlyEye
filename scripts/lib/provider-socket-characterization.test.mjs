// @vitest-environment node
import { createServer } from 'node:http';
import { setImmediate as immediate } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { fixtureConnectionOptions } from './provider-transport-diagnostics.mjs';

// Characterization, not provider/authorization evidence. CI supplies Linux's
// event-loop/socket behavior; each trial owns a fresh loopback listener.
describe('isolated provider socket characterization', () => {
  it.each(['native', 'sdk'])(
    '%s one-shot requests across an idle socket close',
    async (transport) => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        for (const close of [false, true]) {
          let calls = 0;
          const server = createServer((request, response) => {
            request.resume();
            request.on('end', () => {
              calls += 1;
              response.setHeader('content-type', 'application/json');
              response.end(
                JSON.stringify({ id: 'synthetic', type: 'totp', expires_at: 9999999999 }),
              );
            });
          });
          await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
          try {
            const url = `http://127.0.0.1:${server.address().port}`;
            const factorId = '00000000-0000-4000-8000-000000000000';
            const request = (input, init) => {
              const options = close ? fixtureConnectionOptions(input, init, url) : init;
              return fetch(input, { ...options, signal: AbortSignal.timeout(2000) });
            };
            const client = createClient(url, 'synthetic', {
              auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
              global: { fetch: request },
            });
            const invoke = async () => {
              if (transport === 'sdk') {
                const result = await client.auth.mfa.challenge({ factorId });
                return result.error ? result.error.status : 200;
              }
              try {
                const response = await request(`${url}/auth/v1/factors/${factorId}/challenge`, {
                  method: 'POST',
                  body: '{}',
                });
                await response.json();
                return response.status;
              } catch (error) {
                expect(['UND_ERR_SOCKET', 'ECONNRESET']).toContain(error.cause?.code);
                return 0;
              }
            };
            expect(await invoke()).toBe(200);
            server.closeIdleConnections();
            await immediate();
            const status = await invoke();
            expect([0, 200]).toContain(status);
            expect(calls).toBe(status === 200 ? 2 : 1);
            if (close) expect(status).toBe(200);
            process.stdout.write(
              `Socket characterization: ${transport}; connection-close=${close}; ${status === 200 ? 'response' : 'transport-failure'}; requests=${calls}.\n`,
            );
          } finally {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
          }
        }
      } finally {
        logged.mockRestore();
      }
    },
  );
});
