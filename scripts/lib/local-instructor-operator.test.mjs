// @vitest-environment node
import { randomUUID, createHash } from 'node:crypto';
import { beforeEach, it, expect, vi } from 'vitest';
import { localAdminOnboardingHandler } from '../../supabase/functions/organization-admin-onboarding/runtime.ts';
import { localMemberMfaHandler } from '../../supabase/functions/member-mfa/runtime.ts';
import { createMemberAdministrationDependencies } from '../../supabase/functions/member-administration/runtime.ts';
import { createMemberAdministrationHandler } from '../../supabase/functions/member-administration/handler.ts';
import { localJson } from './no-send-runtime-client.mjs';
import { createInstructorOperator } from './local-instructor-operator.mjs';
vi.mock('../../supabase/functions/organization-admin-onboarding/runtime.ts', () => ({
  localAdminOnboardingHandler: vi.fn(),
}));
vi.mock('../../supabase/functions/member-mfa/runtime.ts', () => ({
  localMemberMfaHandler: vi.fn(),
}));
vi.mock('../../supabase/functions/member-administration/runtime.ts', () => ({
  createMemberAdministrationDependencies: vi.fn(),
}));
vi.mock('../../supabase/functions/member-administration/handler.ts', () => ({
  createMemberAdministrationHandler: vi.fn(),
}));
vi.mock('./no-send-runtime-client.mjs', async (original) => ({
  ...(await original()),
  localJson: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
const jwt = (c) => 'synthetic.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.value';
const digest = (x) => createHash('sha256').update(x).digest('hex');
const org = '00000000-0000-4000-8000-000000000099';
function harness(fault) {
  const admin = { id: randomUUID(), email: 'admin@school.invalid' },
    candidate = { id: randomUUID(), email: 'instructor_pilot@school.invalid' };
  const identities = [admin, candidate].map((a) => ({
    ...a,
    session: randomUUID(),
    factor: randomUUID(),
    membership: randomUUID(),
  }));
  const [A, C] = identities;
  const grant = randomUUID(),
    operation = randomUUID(),
    order = [];
  const { keys, operator, candidateForBrowser } = createInstructorOperator(() => ({
    API_URL: 'http://127.0.0.1:58321',
    ANON_KEY: jwt({ role: 'anon' }),
    SERVICE_ROLE_KEY: jwt({ role: 'service_role' }),
  }));
  const session = (a, level) => ({
    user: { id: a.id, email: a.email },
    access_token: jwt({
      sub: a.id,
      role: 'authenticated',
      aal: level,
      session_id: fault === 'changed-session' && level === 'aal2' ? randomUUID() : a.session,
    }),
  });
  localJson.mockImplementation(async (url, options) => {
    expect(new URL(url).origin).toBe('http://127.0.0.1:58321');
    const b = JSON.parse(options.body);
    if (b.email) {
      const a = identities.find((a) => a.email === b.email);
      order.push('login');
      return { status: 200, body: session(a, 'aal1') };
    }
    const a = identities.find(
      (a) => 'Bearer ' + session(a, 'aal1').access_token === options.headers.authorization,
    );
    expect(a).toBeDefined();
    if (url.endsWith('/factors')) {
      order.push('enroll');
      return {
        status: 200,
        body: { id: a.factor, type: 'totp', totp: { secret: 'A'.repeat(32) } },
      };
    }
    if (url.endsWith('/challenge')) {
      order.push('challenge');
      a.challenge = randomUUID();
      return { status: 200, body: { id: a.challenge } };
    }
    expect(url.endsWith('/' + a.factor + '/verify')).toBe(true);
    expect(b.challenge_id).toBe(a.challenge);
    order.push('verify');
    return { status: 200, body: session(a, 'aal2') };
  });
  const handler = async (request) => {
    const b = await request.json(),
      name = new URL(request.url).pathname.split('/').pop();
    const a = name === 'member-mfa' ? C : A;
    const level = ['complete', 'assign_role'].includes(b.action) ? 'aal2' : 'aal1';
    expect(request.headers.get('authorization')).toBe('Bearer ' + session(a, level).access_token);
    order.push(name + ' ' + b.action);
    let result;
    if (name === 'organization-admin-onboarding') {
      expect(b.bootstrapGrantId).toBe(grant);
      expect(b.expectedVersion).toBe(1);
      result = {
        decision: b.action === 'start' ? 'ready' : 'completed',
        grantVersion: 1,
        organizationId: org,
        bootstrapGrantId: grant,
        membershipId: A.membership,
        factorState: 'enrollment_required',
        replayed: false,
      };
      if (b.action === 'complete') expect(digest(b.idempotencyKey)).toBe(keys.adminCompleteHash);
    } else if (name === 'member-mfa') {
      if (b.action === 'bind_factor') {
        expect(b.operationId).toBe(operation);
        expect(b.factorId).toBe(C.factor);
        expect(b.expectedVersion).toBe(1);
      }
      if (b.action === 'complete') {
        expect(b.expectedVersion).toBe(2);
        expect(digest(b.idempotencyKey)).toBe(keys.enrollmentCompleteHash);
      }
      result = {
        decision: { start: 'ready', bind_factor: 'bound', complete: 'completed' }[b.action],
        organizationId: org,
        membershipId: C.membership,
        operationVersion: b.action === 'bind_factor' ? 2 : 1,
        operationId: operation,
        replayed: false,
        factorState: 'enrollment_required',
        readinessVersion: 1,
      };
      if (fault === 'wrong-bind' && b.action === 'bind_factor') result.operationId = randomUUID();
    } else {
      expect(b).toMatchObject({
        action: 'assign_role',
        expectedVersion: 1,
        organizationId: org,
        membershipId: C.membership,
        roleCode: 'instructor_pilot',
      });
      expect(digest(b.idempotencyKey)).toBe(keys.assignmentKeyHash);
      result = {
        decision: 'changed',
        organizationId: org,
        membershipId: C.membership,
        version: 2,
        roleCode: 'instructor_pilot',
        replayed: false,
      };
    }
    return Response.json(result);
  };
  localAdminOnboardingHandler.mockResolvedValue(handler);
  localMemberMfaHandler.mockResolvedValue(handler);
  createMemberAdministrationHandler.mockReturnValue(handler);
  async function run() {
    for (const a of [C, A]) operator.passwordFor(a);
    const adminToken = await operator.privateSession({ ...A, phase: 'protected-admin-onboarding' });
    await operator['protected-admin-onboarding'](
      { organizationId: org, userId: A.id, grantId: grant, keyHash: keys.adminCompleteHash },
      adminToken,
    );
    const token = await operator.privateSession({ ...C, phase: 'protected-self-enrollment' });
    await operator['protected-self-enrollment'](
      {
        organizationId: org,
        userId: C.id,
        membershipId: C.membership,
        keyHash: keys.enrollmentCompleteHash,
      },
      token,
    );
    const assign = await operator.privateSession({ ...A, phase: 'protected-role-assignment' });
    await operator['protected-role-assignment'](
      {
        action: 'assign_role',
        organizationId: org,
        membershipId: fault === 'wrong-membership' ? A.membership : C.membership,
        expectedVersion: 1,
        roleCode: 'instructor_pilot',
        reasonCode: 'responsibility_changed',
        keyHash: keys.assignmentKeyHash,
      },
      fault === 'candidate-assign' ? token : assign,
    );
    return candidateForBrowser(
      { candidateId: C.id, adminId: A.id, target: { schoolId: org }, membershipId: C.membership },
      digest(C.factor),
    );
  }
  return { run, order, C };
}
it('uses protected starts, unverified bind, same-session step-up and the original Admin for assignment', async () => {
  const h = harness();
  const a = await h.run();
  expect(a.id).toBe(h.C.id);
  expect(createMemberAdministrationDependencies).toHaveBeenCalledOnce();
  expect(h.order).toEqual([
    'login',
    'organization-admin-onboarding start',
    'enroll',
    'challenge',
    'verify',
    'organization-admin-onboarding complete',
    'login',
    'member-mfa start',
    'enroll',
    'member-mfa bind_factor',
    'challenge',
    'verify',
    'member-mfa complete',
    'member-administration assign_role',
  ]);
});
it.each(['wrong-bind', 'changed-session', 'candidate-assign', 'wrong-membership'])(
  'stops on %s before privileged assignment',
  async (fault) => {
    const h = harness(fault);
    await expect(h.run()).rejects.toThrow();
    expect(h.order).not.toContain('member-administration assign_role');
  },
);
