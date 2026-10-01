import assert from 'node:assert/strict';

// Keep failure evidence before restoration can replace the active diagnostic stage.
export async function runInactiveRoleProbe({
  diagnostics,
  disableRole,
  requestProfile,
  restoreRole,
}) {
  async function step(stage, operation, detail) {
    diagnostics.enter(stage);
    try {
      const result = await operation();
      diagnostics.pass();
      return result;
    } catch (error) {
      diagnostics.fail(
        error,
        detail === 'transport-failed' && error?.name === 'TimeoutError' ? 'timeout' : detail,
      );
      throw error;
    }
  }

  const failures = [];
  try {
    await step('inactive-role-disable', disableRole, 'database-operation-failed');
    const response = await step('inactive-role-request', requestProfile, 'transport-failed');
    await step(
      'inactive-role-response',
      () => diagnostics.readResponse(response),
      'response-decoding-failed',
    );
    await step('inactive-role-status', () => assert.equal(response.status, 404));
  } catch (error) {
    failures.push(error);
  }

  // A failed disable can have an uncertain database outcome: restoration still runs.
  try {
    await step('inactive-role-restore', restoreRole, 'database-operation-failed');
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Synthetic inactive-role probe failed.');
}
