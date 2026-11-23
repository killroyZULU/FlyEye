import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function raceReplacementCommits({ apiUrl, command, request, assertPrepared }) {
  const rpc = new URL('/rest/v1/rpc/credential_owner_submission', apiUrl);
  assert.equal(rpc.protocol, 'http:');
  assert.equal(rpc.hostname, '127.0.0.1');
  const operations = [randomUUID(), randomUUID()];
  const waiting = new Map();
  const gate = Promise.withResolvers();
  void gate.promise.catch(() => {});
  const deadline = setTimeout(() => gate.reject(new Error('Both commits did not arrive.')), 15000);
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === rpc.href && init?.method === 'POST') {
      const body = JSON.parse(init.body);
      if (body.p_action === 'commit' && operations.includes(body.p_details.operationId)) {
        try {
          assert.equal(body.p_details.expectedPendingId, command.expectedPendingId);
          assert.ok(!waiting.has(body.p_details.operationId));
          waiting.set(body.p_details.operationId, body.p_version);
          if (waiting.size === 2) {
            assert.equal(new Set(waiting.values()).size, 2);
            assertPrepared([...waiting.values()]);
            gate.resolve();
          }
          await gate.promise;
        } catch (error) {
          gate.reject(error);
          throw error;
        }
      }
    }
    return original(input, init);
  };
  try {
    const outcomes = await Promise.allSettled(
      operations.map((operationId) => request({ ...command, operationId })),
    );
    assert.equal(waiting.size, 2);
    return outcomes.map((outcome, i) => {
      assert.equal(outcome.status, 'fulfilled');
      return {
        response: outcome.value,
        operationId: operations[i],
        versionId: waiting.get(operations[i]),
      };
    });
  } finally {
    clearTimeout(deadline);
    globalThis.fetch = original;
  }
}
