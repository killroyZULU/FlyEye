import assert from 'node:assert/strict';
import { waitForSql } from './h002-postgres-session.mjs';

export async function recipientResult(task) {
  const outcome = await task;
  if (outcome.error) throw outcome.error;
  return outcome.value;
}

export async function releaseRecipientSessions(blocker, observer, tasks, pids, psql, diagnostics) {
  const failures = [];
  const attempt = async (stage, operation) => {
    try {
      await diagnostics.run(stage, operation);
    } catch (error) {
      failures.push(error);
    }
  };
  await attempt('recipient-release', () => blocker.close());
  await Promise.allSettled(tasks);
  for (const [index, task] of tasks.entries())
    await attempt(
      index === 0 ? 'recipient-command-response' : 'recipient-auth-response',
      async () => {
        const value = await recipientResult(task);
        if ('error' in value) {
          if (value.error instanceof Error) throw value.error;
          assert.equal(value.error, null);
        } else assert.equal(value.response.status, 200);
      },
    );
  const known = pids.filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  if (known.length)
    await attempt('recipient-idle', () =>
      waitForSql(
        observer,
        `select not exists(select 1 from pg_stat_activity
    where pid in (${known.join(',')}) and (state<>'idle' or xact_start is not null));`,
      ),
    );
  await attempt('recipient-blocker-absence', async () =>
    assert.equal(
      await observer.query(
        "select count(*) from pg_stat_activity where application_name='r4_provider_blocker';",
      ),
      '0',
    ),
  );
  await attempt('recipient-observer-close', () => observer.close());
  await attempt('recipient-session-absence', () =>
    assert.equal(
      psql(
        "select count(*) from pg_stat_activity where application_name in ('r4_provider_blocker','r4_provider_observer');",
      ),
      '0',
    ),
  );
  if (failures.length)
    throw new AggregateError(failures, 'Recipient settlement or cleanup failed.');
}
