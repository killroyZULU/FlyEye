import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { lifecycleMigrationDigest } from './local-lifecycle-migrations.mjs';
import { studentUuid, withStudentJournal } from './local-student-journal.mjs';
import { isOwnedLocalStudentTarget } from './no-send-local-project.mjs';

const schoolId = '00000000-0000-4000-8000-000000000099';
const projectRef = 'flyeye-nosend-p3d1';
const email = 'student_pilot@school.invalid';
const role = 'student_pilot';
const sqlFile = (name) =>
  readFileSync(
    new URL('../sql/local-student-fixture' + name + '.sql', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
function requireMatch(matches) {
  if (!matches) throw new Error('Local Student evidence rejected.');
}

const eligibleAuth = `select count(*) = 1 and count(*) filter (
  where id = current_setting('fixture.user_id')::uuid and email = 'student_pilot@school.invalid'
    and raw_app_meta_data->>'flyeye_fixture_create_operation' = current_setting('fixture.operation_id')
    and email_confirmed_at <= transaction_timestamp() and deleted_at is null
    and (banned_until is null or banned_until <= transaction_timestamp()) and is_anonymous is false
) = 1 and (select count(*) = 1 and bool_and(id = '00000000-0000-4000-8000-000000000099'
    and status = 'active') from public.organizations)
  and not exists (select from public.organization_memberships)
  and not exists (select from public.organization_member_profiles)
  and not exists (select from public.membership_roles)
  and not exists (select from public.organization_admin_bootstrap_grants)
  and not exists (select from staging_private.student_fixture_receipts)
  from auth.users;`;
const emptySchool = `select (select count(*) = 1 and bool_and(
  id = '00000000-0000-4000-8000-000000000099' and status = 'active') from public.organizations)
  and not exists (select from auth.users) and not exists (select from public.organization_memberships)
  and not exists (select from public.organization_admin_bootstrap_grants)
  and not exists (select from staging_private.student_fixture_receipts);`;

// This module has no executable entrypoint. The owned school provides SQL transport
// pinned to its immutable container and cluster; it cannot accept a URL or database name.
export function localStudentOperations(target, withJournal = withStudentJournal) {
  requireMatch(isOwnedLocalStudentTarget(target));
  const writeSql = sqlFile('');
  const readSql = sqlFile('-readback');
  const revision = createHash('sha256')
    .update([lifecycleMigrationDigest, writeSql, readSql].join('\0'))
    .digest('hex');
  function validate(intent, journal, witness) {
    requireMatch(
      intent?.version === 1 &&
        intent.projectRef === projectRef &&
        intent.schoolId === schoolId &&
        intent.email === email &&
        intent.role === role &&
        intent.revision === revision &&
        intent.runId === journal.runId &&
        intent.instance === witness.instance &&
        intent.systemId === witness.systemId &&
        /^[0-9a-f]{64}$/.test(intent.instance) &&
        /^[1-9][0-9]{0,19}$/.test(intent.systemId),
    );
    const ids = [intent.runId, intent.userId, intent.operationId, intent.membershipId];
    requireMatch(ids.every(studentUuid) && new Set(ids).size === ids.length);
  }
  function sql(journal, intent, attempt, body, write = false) {
    journal.check();
    validate(intent, journal, target.witness());
    const settings = {
      instance_digest: intent.instance,
      database_system_id: intent.systemId,
      run_id: intent.runId,
      operation_id: intent.operationId,
      membership_id: intent.membershipId,
      user_id: intent.userId,
    };
    if (attempt) {
      requireMatch(
        attempt.runId === intent.runId &&
          studentUuid(attempt.id) &&
          !Object.values(settings).includes(attempt.id),
      );
      settings.attempt_id = attempt.id;
    }
    const setup = Object.entries(settings)
      .map(([key, value]) => `set local fixture.${key} = '${value}';`)
      .join('\n');
    return target.sql(`begin${write ? '' : ' read only'};
set local lock_timeout = '3s';
set local statement_timeout = '10s';
${setup}
${body}
commit;`);
  }
  function acknowledge(journal, intent, attempt) {
    const checkJournal = () => {
      requireMatch(
        isDeepStrictEqual(journal.read('intent'), intent) &&
          isDeepStrictEqual(journal.read('attempt'), attempt),
      );
      journal.bindInstance(intent.instance, false);
    };
    checkJournal();
    const profileId = sql(journal, intent, attempt, readSql);
    requireMatch(studentUuid(profileId));
    validate(intent, journal, target.witness());
    checkJournal();
    const saved = journal.read('confirmed');
    const confirmed = { runId: intent.runId, attemptId: attempt.id, profileId };
    if (saved === null) journal.record('confirmed', confirmed);
    else
      requireMatch(
        saved.runId === confirmed.runId &&
          saved.attemptId === confirmed.attemptId &&
          saved.profileId === profileId,
      );
    return { runId: intent.runId, membershipId: intent.membershipId, profileId };
  }
  return {
    // createOwnedAuth is the existing operator's preconfirmed, no-send Auth step.
    // Only generated non-secret intent is handed to it. Its return value is never evidence.
    establishStudent(createOwnedAuth) {
      return withJournal(null, async (journal) => {
        requireMatch(typeof createOwnedAuth === 'function');
        const witness = target.witness();
        const intent = {
          version: 1,
          projectRef,
          schoolId,
          role,
          email,
          revision,
          runId: journal.runId,
          operationId: randomUUID(),
          userId: randomUUID(),
          membershipId: randomUUID(),
          instance: witness.instance,
          systemId: witness.systemId,
        };
        requireMatch(sql(journal, intent, null, emptySchool) === 't');
        journal.bindInstance(intent.instance, true);
        journal.record('intent', intent);
        validate(intent, journal, target.witness());
        journal.check();
        await createOwnedAuth(
          Object.freeze({
            runId: intent.runId,
            id: intent.userId,
            email,
            operationId: intent.operationId,
          }),
        );
        journal.check();
        journal.bindInstance(intent.instance, false);
        requireMatch(
          isDeepStrictEqual(journal.read('intent'), intent) &&
            journal.read('attempt') === null &&
            journal.read('confirmed') === null,
        );
        requireMatch(sql(journal, intent, null, eligibleAuth) === 't');
        const attempt = { runId: intent.runId, id: randomUUID() };
        journal.record('attempt', attempt);
        requireMatch(
          isDeepStrictEqual(journal.read('intent'), intent) &&
            isDeepStrictEqual(journal.read('attempt'), attempt),
        );
        // Once this point is reached, reconciliation is read-only even on lost acknowledgment.
        sql(journal, intent, attempt, writeSql, true);
        return acknowledge(journal, intent, attempt);
      });
    },
    reconcileStudent(runId) {
      return withJournal(runId, (journal) => {
        const intent = journal.read('intent');
        validate(intent, journal, target.witness());
        journal.bindInstance(intent.instance, false);
        const attempt = journal.read('attempt');
        if (attempt === null) {
          requireMatch(
            journal.read('confirmed') === null && sql(journal, intent, null, eligibleAuth) === 't',
          );
          return { runId, state: 'auth-confirmed-membership-pending' };
        }
        return acknowledge(journal, intent, attempt);
      });
    },
  };
}
