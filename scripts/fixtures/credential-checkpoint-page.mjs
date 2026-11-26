import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';

const host = '127.0.0.1';
const port = 58329;
const authority = host + ':' + port;

export async function openCheckpointPage(origin) {
  assert.equal(origin, 'http://' + authority);
  let documents = 0;
  const server = createServer((request, response) => {
    if (request.headers.host !== authority || request.method !== 'GET' || request.url !== '/') {
      response.writeHead(403, { Connection: 'close' }).end();
      return;
    }
    documents++;
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end('<!doctype html><link rel="icon" href="data:,"><div id="root"></div>');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port, exclusive: true }, resolve);
  });
  return {
    verifyNavigation(response, reloaded = false) {
      assert.equal(response?.url(), origin + '/');
      assert.equal(response.status(), 200);
      assert.equal(documents, reloaded ? 2 : 1);
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      assert.equal(server.listening, false);
      const refused = await new Promise((resolve) => {
        const socket = createConnection({ host, port });
        socket.once('connect', () => {
          socket.destroy();
          resolve(false);
        });
        socket.once('error', (error) => resolve(error.code === 'ECONNREFUSED'));
        socket.setTimeout(1500, () => {
          socket.destroy();
          resolve(false);
        });
      });
      assert.ok(refused, 'Checkpoint page listener shutdown unverified.');
    },
  };
}
