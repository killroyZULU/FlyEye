import { createHash, randomBytes } from 'node:crypto';
import { localAdminOnboardingHandler } from '../../supabase/functions/organization-admin-onboarding/runtime.ts';
import { localMemberMfaHandler } from '../../supabase/functions/member-mfa/runtime.ts';
import { createMemberAdministrationHandler } from '../../supabase/functions/member-administration/handler.ts';
import { createMemberAdministrationDependencies } from '../../supabase/functions/member-administration/runtime.ts';
import {
  studentGateway,
  studentOrigin,
  gatewayOnlyFetch,
  tokenClaims,
} from './local-student-router.mjs';
import { currentTotp, localJson } from './no-send-runtime-client.mjs';
import { studentUuid } from './local-student-journal.mjs';

const hex = () => randomBytes(32).toString('hex');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const check = (value) => {
  if (!value) throw new Error('Private Instructor operation rejected.');
};
const school = '00000000-0000-4000-8000-000000000099';
const adminEmail = 'admin@school.invalid',
  candidateEmail = 'instructor_pilot@school.invalid';

// All setup handlers execute in the operator process. Only the candidate's
// login, factor challenge and protected reads are available in the browser.
export function createInstructorOperator(loadStatus) {
  const secrets = {
    adminCompleteHash: hex(),
    enrollmentCompleteHash: hex(),
    assignmentKeyHash: hex(),
  };
  const keys = Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, hash(v)]));
  const accounts = new Map();
  const limiter = Object.fromEntries(
    ['003', '005', '006'].map((n) => ['FEAT' + n + '_LIMITER_HMAC_SECRET', hex()]),
  );
  let handlers;
  function status() {
    const s = loadStatus();
    check(
      s.API_URL === studentGateway &&
        tokenClaims(s.ANON_KEY)?.role === 'anon' &&
        tokenClaims(s.SERVICE_ROLE_KEY)?.role === 'service_role',
    );
    return s;
  }
  async function auth(path, body, token) {
    const key = status().ANON_KEY;
    const res = await localJson(studentGateway + '/auth/v1/' + path, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: 'Bearer ' + (token ?? key),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    check(res.status >= 200 && res.status < 300);
    return res.body;
  }
  async function invoke(name, body, token) {
    const s = status();
    if (!handlers) {
      const config = {
        SUPABASE_URL: studentGateway,
        SUPABASE_ANON_KEY: s.ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY,
        ALLOWED_ORIGIN: studentOrigin,
        FLYEYE_RUNTIME_PROFILE: 'local-synthetic-v1',
        ...limiter,
        FEAT003_DATA_CLASSIFICATION: 'synthetic-only',
        FEAT005_DATA_CLASSIFICATION: 'synthetic-only',
        FEAT006_DATA_CLASSIFICATION: 'synthetic-only',
        FEAT003_LIMITER_POLICY_VERSION: 'subject-action-v1',
        FEAT005_LIMITER_POLICY_VERSION: 'member-administration-subject-scope-v1',
        FEAT006_LIMITER_POLICY_VERSION: 'member-mfa-subject-action-v1',
      };
      const read = (k) => config[k];
      const pinned = gatewayOnlyFetch(fetch);
      const transport = (input, init) => {
        status();
        return pinned(input, init);
      };
      handlers = {
        'organization-admin-onboarding': await localAdminOnboardingHandler(read, transport),
        'member-mfa': await localMemberMfaHandler(read, transport),
        'member-administration': createMemberAdministrationHandler(
          await createMemberAdministrationDependencies(read, transport),
        ),
      };
    }
    const res = await handlers[name](
      new Request(studentOrigin + '/functions/v1/' + name, {
        method: 'POST',
        headers: {
          apikey: s.ANON_KEY,
          authorization: 'Bearer ' + token,
          origin: studentOrigin,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );
    check(res.status === 200);
    return res.json();
  }
  function actor(email, command, token, key) {
    const a = accounts.get(email);
    check(
      a &&
        command.organizationId === school &&
        command.keyHash === keys[key] &&
        a.accessToken === token &&
        tokenClaims(token)?.sub === a.id,
    );
    return a;
  }
  function acceptSession(a, session, level) {
    const claims = tokenClaims(session.access_token);
    check(
      session.user?.id === a.id &&
        session.user.email === a.email &&
        claims?.sub === a.id &&
        claims.role === 'authenticated' &&
        claims.aal === level &&
        studentUuid(claims.session_id) &&
        (!a.sessionId || a.sessionId === claims.session_id),
    );
    a.sessionId = claims.session_id;
    a.accessToken = session.access_token;
  }
  async function enroll(a, bind) {
    const f = await auth(
      'factors',
      { factor_type: 'totp', friendly_name: 'Local fixture authenticator' },
      a.accessToken,
    );
    check(studentUuid(f.id) && f.type === 'totp' && /^[A-Z2-7]{16,128}$/.test(f.totp?.secret));
    if (bind) await bind(f.id);
    const challenge = await auth('factors/' + f.id + '/challenge', {}, a.accessToken);
    check(studentUuid(challenge.id));
    const code = currentTotp(f.totp.secret);
    const promoted = await auth(
      'factors/' + f.id + '/verify',
      { challenge_id: challenge.id, code },
      a.accessToken,
    );
    acceptSession(a, promoted, 'aal2');
    a.factorId = f.id;
    a.totp = f.totp.secret;
    a.lastCode = code;
  }
  const operator = {
    passwordFor({ id, email }) {
      check(
        [adminEmail, candidateEmail].includes(email) &&
          studentUuid(id) &&
          !accounts.has(email) &&
          [...accounts.values()].every((a) => a.id !== id),
      );
      const password = hex();
      accounts.set(email, { id, email, password });
      return password;
    },
    async privateSession({ phase, id, email }) {
      const a = accounts.get(email);
      check(
        a?.id === id &&
          email === (phase === 'protected-self-enrollment' ? candidateEmail : adminEmail),
      );
      if (phase === 'protected-role-assignment') {
        check(tokenClaims(a.accessToken)?.aal === 'aal2');
        return a.accessToken;
      }
      check(!a.accessToken);
      acceptSession(
        a,
        await auth('token?grant_type=password', { email, password: a.password }),
        'aal1',
      );
      return a.accessToken;
    },
    async 'protected-admin-onboarding'(c, token) {
      const a = actor(adminEmail, c, token, 'adminCompleteHash');
      check(c.userId === a.id);
      const name = 'organization-admin-onboarding';
      const started = await invoke(
        name,
        { action: 'start', bootstrapGrantId: c.grantId, expectedVersion: 1, idempotencyKey: hex() },
        token,
      );
      check(
        started.decision === 'ready' &&
          started.organizationId === school &&
          started.bootstrapGrantId === c.grantId &&
          started.grantVersion === 1 &&
          started.factorState === 'enrollment_required' &&
          started.replayed === false,
      );
      await enroll(a);
      const done = await invoke(
        name,
        {
          action: 'complete',
          bootstrapGrantId: c.grantId,
          expectedVersion: started.grantVersion,
          idempotencyKey: secrets.adminCompleteHash,
        },
        a.accessToken,
      );
      check(
        done.decision === 'completed' &&
          done.organizationId === school &&
          done.bootstrapGrantId === c.grantId &&
          studentUuid(done.membershipId),
      );
      a.membershipId = done.membershipId;
    },
    async 'protected-self-enrollment'(c, token) {
      const a = actor(candidateEmail, c, token, 'enrollmentCompleteHash');
      check(a.id === c.userId);
      const name = 'member-mfa';
      const start = await invoke(name, { action: 'start', idempotencyKey: hex() }, token);
      check(
        start.decision === 'ready' &&
          start.organizationId === school &&
          start.membershipId === c.membershipId &&
          start.factorState === 'enrollment_required' &&
          start.replayed === false &&
          studentUuid(start.operationId) &&
          start.operationVersion === 1,
      );
      let bound;
      await enroll(a, async (factorId) => {
        bound = await invoke(
          name,
          {
            action: 'bind_factor',
            operationId: start.operationId,
            expectedVersion: start.operationVersion,
            factorId,
            idempotencyKey: hex(),
          },
          token,
        );
        check(
          bound.decision === 'bound' &&
            bound.operationId === start.operationId &&
            bound.operationVersion === 2 &&
            bound.replayed === false,
        );
      });
      const done = await invoke(
        name,
        {
          action: 'complete',
          operationId: start.operationId,
          expectedVersion: bound.operationVersion,
          idempotencyKey: secrets.enrollmentCompleteHash,
        },
        a.accessToken,
      );
      check(
        done.decision === 'completed' &&
          done.organizationId === school &&
          done.membershipId === c.membershipId &&
          done.readinessVersion === 1 &&
          done.replayed === false,
      );
      a.membershipId = c.membershipId;
    },
    async 'protected-role-assignment'(c, token) {
      const admin = actor(adminEmail, c, token, 'assignmentKeyHash');
      const candidate = accounts.get(candidateEmail);
      check(
        candidate &&
          candidate.id !== admin.id &&
          studentUuid(candidate.membershipId) &&
          candidate.membershipId === c.membershipId,
      );
      const { keyHash, ...command } = c;
      check(
        keyHash === keys.assignmentKeyHash &&
          command.action === 'assign_role' &&
          command.expectedVersion === 1 &&
          command.roleCode === 'instructor_pilot' &&
          command.reasonCode === 'responsibility_changed',
      );
      const done = await invoke(
        'member-administration',
        { ...command, idempotencyKey: secrets.assignmentKeyHash },
        token,
      );
      check(
        done.decision === 'changed' &&
          done.organizationId === school &&
          done.membershipId === command.membershipId &&
          done.version === 2 &&
          done.roleCode === 'instructor_pilot' &&
          done.replayed === false,
      );
    },
  };
  return {
    keys,
    operator,
    adminForBrowser({ intent, receipt }) {
      const a = accounts.get(adminEmail);
      check(
        a &&
          a.id === intent.adminId &&
          a.id !== intent.candidateId &&
          intent.target.schoolId === school &&
          studentUuid(a.membershipId) &&
          a.membershipId === receipt.membershipId &&
          hash(a.factorId) === receipt.factorHash,
      );
      return {
        id: a.id,
        email: adminEmail,
        password: a.password,
        secret: a.totp,
        lastCode: a.lastCode,
        setupSessionId: a.sessionId,
        factorId: a.factorId,
        schoolId: school,
        membershipId: a.membershipId,
        studentMembershipId: intent.membershipId,
      };
    },
    candidateForBrowser(intent, factorHash) {
      const a = accounts.get(candidateEmail);
      check(
        a &&
          a.id === intent.candidateId &&
          intent.target.schoolId === school &&
          a.id !== intent.adminId &&
          a.membershipId === intent.membershipId &&
          hash(a.factorId) === factorHash,
      );
      return {
        id: a.id,
        email: a.email,
        password: a.password,
        secret: a.totp,
        lastCode: a.lastCode,
        setupSessionId: a.sessionId,
        factorId: a.factorId,
        schoolId: school,
        membershipId: intent.membershipId,
      };
    },
  };
}
