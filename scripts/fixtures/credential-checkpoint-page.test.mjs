import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { openCheckpointPage } from './credential-checkpoint-page.mjs';
import { publicLine } from './credential-checkpoint-log.mjs';

const origin = 'http://127.0.0.1:58329';
function visit(path, options = {}) {
  return new Promise((resolve, reject) => {
    request(origin + path, { agent: false, ...options }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.once('end', () => resolve({ body, status: response.statusCode }));
      response.once('error', reject);
    })
      .once('error', reject)
      .end();
  });
}

describe('runner-local checkpoint page', () => {
  it.each(['http://0.0.0.0:58329', 'http://127.0.0.1:58321'])(
    'rejects an unapproved origin before binding',
    async (other) => {
      await expect(openCheckpointPage(other)).rejects.toThrow();
    },
  );
  it('retains the owned listener on collision, serves only the static root and verifies shutdown', async () => {
    const listener = await openCheckpointPage(origin);
    const navigation = { url: () => origin + '/', status: () => 200 };
    try {
      expect(() => listener.verifyNavigation(navigation)).toThrow();
      await expect(openCheckpointPage(origin)).rejects.toMatchObject({ code: 'EADDRINUSE' });
      for (const [path, options] of [
        ['/auth/v1/token', {}],
        ['/?x=1', {}],
        ['/', { method: 'POST' }],
        ['/', { headers: { Host: 'other.invalid' } }],
      ]) {
        expect(await visit(path, options)).toEqual({ status: 403, body: '' });
      }
      expect(await visit('/')).toEqual({
        status: 200,
        body: '<!doctype html><link rel="icon" href="data:,"><div id="root"></div>',
      });
      listener.verifyNavigation(navigation);
      expect(() => listener.verifyNavigation({ ...navigation, status: () => 403 })).toThrow();
      expect(() =>
        listener.verifyNavigation({ ...navigation, url: () => origin + '/other' }),
      ).toThrow();
      expect(() => listener.verifyNavigation(navigation, true)).toThrow();
      await visit('/');
      expect(() => listener.verifyNavigation(navigation)).toThrow();
      listener.verifyNavigation(navigation, true);
      await visit('/');
      expect(() => listener.verifyNavigation(navigation, true)).toThrow();
    } finally {
      await listener.close();
    }
    await expect(visit('/')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
  it.each(['verified', 'failed'])('publishes only the fixed %s shutdown line', (result) => {
    const line = 'Checkpoint page listener shutdown ' + result + '.';
    expect(publicLine(line)).toBe(line);
    expect(publicLine(line + ' private detail')).toBeNull();
  });
});
