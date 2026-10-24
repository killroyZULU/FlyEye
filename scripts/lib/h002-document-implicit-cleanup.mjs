import assert from 'node:assert/strict';
import { cleanup, residue, permissions } from './h002-document-implicit-fixture.mjs';

export const sessionsAbsent = `select count(*) from pg_stat_activity
  where application_name like 'h002_document_implicit_%'
  and application_name <> 'h002_document_implicit_cleanup';`;

export async function finishCleanup(session, { owned, safe, originalPermissions }) {
  assert.ok(safe, 'Owned session settlement or case cleanup is unverified');
  assert.equal(await session.query(sessionsAbsent), '0', 'Owned SQL sessions remain');
  if (!owned) return false;
  await session.query(`begin; ${cleanup} commit;`);
  assert.equal(await session.query(residue), '0');
  assert.equal(await session.query(permissions), originalPermissions);
  return true;
}
