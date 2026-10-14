import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadUncertaintyHandlers, withProviderFault } from './onboarding-uncertainty-adapter.mjs';
import { issueGrant } from './onboarding-provider-cases.mjs';
import {
  assertProviderBootstrap,
  assertProviderCompletion,
  providerAuthenticationMethods,
} from './onboarding-provider-evidence.mjs';
import { assertStaleTransition } from './onboarding-stale-evidence.mjs';
import { assertUncertaintyDenial } from './onboarding-uncertainty-evidence.mjs';

export const uncertaintyServerCases = [
  'authentication-start',
  'authentication-complete',
  'factors-start',
  'factors-complete',
  'bootstrap',
];

export async function runUncertaintyServer(context) {
  const {
    users,
    organizationId,
    sourceInstanceId,
    psql,
    signIn,
    promoteToAal2,
    evidence,
    invoke,
    clearScenario,
    enterStage,
    reportDiagnostic,
    origin,
    apiUrl,
  } = context;
  const [onboarding, bootstrap] = await loadUncertaintyHandlers(context);
  assert.equal(users.length, uncertaintyServerCases.length);
  const adminRoleId = evidence.json("select to_jsonb(id) from public.roles where code='admin';");
  for (const [index, name] of uncertaintyServerCases.entries()) {
    const stage = `uncertainty-${name}`;
    const user = users[index];
    const grantId = randomUUID();
    const details = { userId: user.id, organizationId, grantId };
    issueGrant(psql, organizationId, user.id, grantId, sourceInstanceId);
    const actor = await promoteToAal2(await signIn(user));
    enterStage(stage, stage);
    evidence.captureParents();
    const methods = providerAuthenticationMethods(actor.session.access_token, user.id);
    const snapshot = () => evidence.snapshot(user.id, grantId);
    const body = (action) => ({
      action,
      bootstrapGrantId: grantId,
      expectedVersion: 1,
      idempotencyKey: randomBytes(16).toString('hex'),
    });
    async function positive(action) {
      const input = body(action);
      const before = snapshot();
      const result = await invoke(
        'organization-admin-onboarding',
        actor.session.access_token,
        input,
      );
      const after = snapshot();
      const options = {
        ...details,
        key: input.idempotencyKey,
        factorState: 'challenge_required',
        assuranceLevel: 'aal2',
        authenticationMethods: methods,
        adminRoleId,
      };
      if (action === 'start') assertStaleTransition('start', before, after, result, options);
      else assertProviderCompletion(before, after, result, options);
    }
    const action = name.endsWith('start') ? 'start' : 'complete';
    if (action === 'complete') await positive('start');
    if (name === 'bootstrap') await positive('complete');
    const before = snapshot();
    const isAuthentication = name.startsWith('authentication');
    const faultPath = isAuthentication
      ? '/auth/v1/user'
      : `/auth/v1/admin/users/${user.id}/factors`;
    const failed = await withProviderFault(apiUrl, faultPath, async () => {
      const response = await (name === 'bootstrap' ? bootstrap : onboarding)(
        new Request(
          `${apiUrl}/functions/v1/${name === 'bootstrap' ? 'auth-bootstrap' : 'organization-admin-onboarding'}`,
          {
            method: 'POST',
            headers: {
              origin,
              authorization: `Bearer ${actor.session.access_token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(name === 'bootstrap' ? {} : body(action)),
          },
        ),
      );
      return { status: response.status, payload: await response.json() };
    });
    assert.equal(failed.hits, 1);
    assert.equal(
      failed.requests.some(({ path }) =>
        /\/(start_organization_admin_onboarding|complete_first_organization_admin_bootstrap)$/.test(
          path,
        ),
      ),
      false,
    );
    if (isAuthentication) assert.equal(failed.requests.length, 1);
    assertUncertaintyDenial(before, snapshot(), failed.value, {
      ...details,
      kind: name === 'bootstrap' ? 'bootstrap' : isAuthentication ? 'authentication' : 'factors',
    });
    if (name !== 'bootstrap') {
      // A failed factor lookup still consumes the single COMPLETE token. Respect
      // its existing 20-second refill before the explicit restored-provider control.
      if (name === 'factors-complete') await new Promise((resolve) => setTimeout(resolve, 20_100));
      await positive(action);
      if (action === 'start') await positive('complete');
    }
    const committed = snapshot();
    const access = await invoke('auth-bootstrap', actor.session.access_token, {});
    assertProviderBootstrap(committed, snapshot(), access, { ...details, removed: false });
    assert.equal(
      snapshot().events.filter((event) => event.event_name === 'admin_onboarding.completed').length,
      1,
    );
    evidence.captureParents();
    evidence.assertAuthority();
    clearScenario(grantId, user.id);
    reportDiagnostic(stage, 'passed');
  }
}
