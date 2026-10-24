import assert from 'node:assert/strict';

export const sessionsAbsent = `select count(*) from pg_stat_activity
  where application_name like 'h002_registry_implicit_%'
  and application_name <> 'h002_registry_implicit_cleanup';`;

// Always settle every owned child and query session state, even when a close fails.
// No caller may reset/delete data unless this function returns successfully.
export async function quiesce(sessions, tasks, query, absenceSql) {
  const closed = await Promise.allSettled(
    sessions.map((session) => Promise.resolve().then(() => session.close())),
  );
  const settled = await Promise.allSettled(tasks.map((task) => task.result));
  const absent = await query(absenceSql);
  assert.equal(absent, '0', 'Owned SQL session absence is unverified');
  assert.ok(
    closed.every((result) => result.status === 'fulfilled'),
    'Owned session close failed',
  );
  assert.ok(
    settled.every((entry) => entry.status === 'fulfilled' && !entry.value.error),
    'Owned worker did not settle safely',
  );
}
