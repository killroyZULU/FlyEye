import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const email = /^[a-z0-9_-]+@example\.test$/;
const values = (items) => (items.length ? items.map((item) => `'${item}'`).join(',') : 'null');

export function checkedRuntimeSql(sql, tuplesOnly = false, execute = spawnSync) {
  const args = [
    'exec',
    '-i',
    'supabase_db_flyeye',
    'psql',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'postgres',
    '-d',
    'postgres',
  ];
  if (tuplesOnly) args.push('-At');
  const result = execute('docker', args, {
    input: sql,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error('Synthetic database operation failed.');
  return result.stdout.trim();
}

export function onboardingCleanupSecret(environment) {
  const secret = environment.FEAT003_LIMITER_HMAC_SECRET;
  if (
    environment.FLYEYE_RUNTIME_PROFILE !== 'local-synthetic-v1' ||
    environment.FEAT003_DATA_CLASSIFICATION !== 'synthetic-only' ||
    environment.FEAT003_LIMITER_POLICY_VERSION !== 'subject-action-v1' ||
    typeof secret !== 'string' ||
    Buffer.byteLength(secret) < 32 ||
    /(change[-_ ]?me|example|placeholder|replace[-_ ]?me|your[-_ ])/i.test(secret)
  ) {
    throw new Error('Synthetic onboarding cleanup ownership is unavailable.');
  }
  return secret;
}

export function authCleanupScope({ identities, extraEmails = [], organizationId, limiterSecret }) {
  assert.ok(uuid.test(organizationId));
  assert.ok(Array.isArray(identities) && identities.length > 0);
  assert.ok(identities.every((identity) => uuid.test(identity.id) && email.test(identity.email)));
  assert.ok(extraEmails.every((entry) => email.test(entry)));
  const ids = [...new Set(identities.map((identity) => identity.id))];
  const emails = [...new Set([...identities.map((identity) => identity.email), ...extraEmails])];
  if (limiterSecret !== undefined)
    assert.ok(typeof limiterSecret === 'string' && Buffer.byteLength(limiterSecret) >= 32);
  const limiterKeys =
    limiterSecret === undefined
      ? []
      : ids.flatMap((id) =>
          ['status', 'start', 'complete', 'cancel'].map((action) =>
            createHmac('sha256', limiterSecret).update(`${id}\u0000${action}`).digest('hex'),
          ),
        );
  return { ids, emails, organizationId, limiterKeys };
}

export function authScopeSql(scope, parents = { sessions: [], factors: [] }) {
  assert.ok(scope.ids.every((id) => uuid.test(id)) && scope.ids.length > 0);
  assert.ok(scope.emails.every((entry) => email.test(entry)) && scope.emails.length > 0);
  assert.ok(uuid.test(scope.organizationId));
  assert.ok(scope.limiterKeys.every((key) => /^[0-9a-f]{64}$/.test(key)));
  assert.ok(
    parents.sessions.every((id) => uuid.test(id)) && parents.factors.every((id) => uuid.test(id)),
  );
  const ids = values(scope.ids);
  const emails = values(scope.emails);
  const limiter = scope.limiterKeys.length
    ? `limiter_key_hash in (${values(scope.limiterKeys)})`
    : 'false';
  const organization = `'${scope.organizationId}'::uuid`;
  const domain = [
    'organization_member_profiles',
    'membership_roles',
    'organization_memberships',
    'aircraft_document_categories',
  ].map((table) => [table, `organization_id = ${organization}`]);
  const scopedTables = [
    ...domain.map(([table, predicate]) => [`public.${table}`, predicate]),
    ['public.organizations', `id = ${organization}`],
    ['public.authentication_events', `actor_subject_id in (${ids}) or actor_user_id in (${ids})`],
    ['public.auth_bootstrap_rate_limit_state', `actor_user_id in (${ids})`],
    ['public.admin_onboarding_rate_limit_state', limiter],
    ['public.admin_onboarding_rate_limit_events', limiter],
    ['auth.users', `id in (${ids}) or lower(email) in (${emails})`],
    ...[
      'identities',
      'sessions',
      'refresh_tokens',
      'mfa_factors',
      'flow_state',
      'one_time_tokens',
    ].map((table) => [`auth.${table}`, `user_id::text in (${ids})`]),
    ['auth.mfa_amr_claims', `session_id::text in (${values(parents.sessions)})`],
    ['auth.mfa_challenges', `factor_id::text in (${values(parents.factors)})`],
  ];
  return {
    ids,
    emails,
    limiter,
    residue: `select ${scopedTables.map(([table, predicate]) => `(select count(*) from ${table} where ${predicate})`).join(' + ')};`,
    domain: `begin;
      delete from public.authentication_events where actor_subject_id in (${ids}) or actor_user_id in (${ids});
      ${domain.map(([table, predicate]) => `delete from public.${table} where ${predicate};`).join('\n')}
      delete from public.organizations where id = ${organization}; commit;`,
    limiterCleanup: `begin;
      delete from public.admin_onboarding_rate_limit_events where ${limiter};
      delete from public.admin_onboarding_rate_limit_state where ${limiter};
      delete from public.auth_bootstrap_rate_limit_state where actor_user_id in (${ids}); commit;`,
    foreignLimiter: `select jsonb_build_array(
      (select coalesce(jsonb_agg(to_jsonb(s) order by limiter_key_hash, action), '[]') from public.admin_onboarding_rate_limit_state s where not (${limiter})),
      (select coalesce(jsonb_agg(to_jsonb(e) order by id), '[]') from public.admin_onboarding_rate_limit_events e where not (${limiter}))
    )::text;`,
  };
}

export function preflightAuthCleanup(scope, psql) {
  // Also validates every required table/ownership column against the pinned server before mutation.
  assert.equal(psql(authScopeSql(scope).residue, true), '0');
}
