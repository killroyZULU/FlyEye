import assert from 'node:assert/strict';
import { authScopeSql } from './auth-runtime-scope.mjs';

export async function cleanupAuthRuntime({
  scope,
  diagnostics,
  psql,
  deleteUser,
  cleanMail,
  stopFrontend = async () => {},
}) {
  let failed = false;
  const attempt = async (stage, operation) => {
    try {
      await diagnostics.run(stage, operation);
    } catch {
      failed = true;
    }
  };
  let sql = authScopeSql(scope);
  let foreign;
  const parents = { sessions: [], factors: [] };
  await attempt('cleanup-edge-shutdown', stopFrontend);
  await attempt('cleanup-identity-discovery', () => {
    const inventory = JSON.parse(
      psql(
        `select jsonb_build_object(
      'ids', (select coalesce(jsonb_agg(id), '[]') from auth.users where id in (${sql.ids}) or lower(email) in (${sql.emails})),
      'sessions', (select coalesce(jsonb_agg(id), '[]') from auth.sessions where user_id in (select id from auth.users where id in (${sql.ids}) or lower(email) in (${sql.emails}))),
      'factors', (select coalesce(jsonb_agg(id), '[]') from auth.mfa_factors where user_id in (select id from auth.users where id in (${sql.ids}) or lower(email) in (${sql.emails})))
    )::text;`,
        true,
      ),
    );
    assert.ok(
      Array.isArray(inventory.ids) &&
        Array.isArray(inventory.sessions) &&
        Array.isArray(inventory.factors),
    );
    const discovered = { ...scope, ids: [...new Set([...scope.ids, ...inventory.ids])] };
    const validated = authScopeSql(discovered, inventory);
    scope = discovered;
    parents.sessions = inventory.sessions;
    parents.factors = inventory.factors;
    sql = validated;
  });
  await attempt('cleanup-limiter-inventory', () => {
    foreign = psql(sql.foreignLimiter, true);
  });
  await attempt('cleanup-limiter-rows', () => {
    psql(sql.limiterCleanup);
  });
  await attempt('cleanup-domain-rows', () => {
    psql(sql.domain);
  });
  for (const id of scope.ids) {
    await attempt('cleanup-auth-users', async () => {
      const { error } = await deleteUser(id);
      if (error && error.status !== 404) throw new Error('Synthetic Auth deletion failed.');
    });
  }
  await attempt('cleanup-assertions', () => {
    assert.equal(psql(authScopeSql(scope, parents).residue, true), '0');
  });
  await attempt('cleanup-limiter-preservation', () => {
    assert.notEqual(foreign, undefined);
    assert.equal(psql(sql.foreignLimiter, true), foreign);
  });
  await attempt('cleanup-mail', () => cleanMail(scope.emails));
  await attempt('cleanup-provider-audit-inventory', () => {
    // Provider evidence is deliberately retained until disposable stack teardown.
    // Actor-attributable count only; this is not an inventory of all provider artifacts.
    const count = psql(
      `select count(*) from auth.audit_log_entries
      where payload ->> 'actor_id' in (${sql.ids}) or lower(payload ->> 'actor_username') in (${sql.emails});`,
      true,
    );
    assert.match(count, /^\d+$/);
  });
  if (failed) throw new Error('Synthetic Auth fixture cleanup failed.');
}

export async function runAuthFixture({ diagnostics, scenario, cleanup, probe = false }) {
  const interrupted = Symbol('controlled interruption');
  let expectedInterruption = false;
  let failed = false;
  try {
    await scenario(() => {
      if (probe) {
        diagnostics.enter('fixture-failure-injection');
        throw interrupted;
      }
    });
    if (probe) throw new Error('Cleanup probe did not reach its checkpoint.');
    diagnostics.pass();
  } catch (error) {
    if (error === interrupted) {
      expectedInterruption = true;
      diagnostics.pass();
    } else {
      failed = true;
      diagnostics.fail(error);
    }
  }
  try {
    await diagnostics.run('fixture-cleanup', cleanup);
  } catch {
    failed = true;
  }
  if (failed || (probe && !expectedInterruption))
    throw new Error('Synthetic Auth runtime fixture failed.');
}

// A failed shutdown remains uncertain even if later cleanup stages succeed.
export function authFrontendShutdown() {
  let uncertain = false;
  return {
    async stop(operation) {
      try {
        await operation();
      } catch {
        uncertain = true;
        throw new Error('Owned frontend shutdown is uncertain.');
      }
    },
    assertStopped() {
      if (uncertain) throw new Error('Owned frontend shutdown is uncertain.');
    },
  };
}
