import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Existing disposable journals bind this prefix, including the local Student receipt.
export const lifecycleMigrationDigest =
  '1013eaa78050374a68c8faed01ddee2c5ff14068a5cb0641b60c9d4dd96220a7';
export const retainedReceiptMigration = '20261120035141_feat_003_retained_membership_receipts.sql';
export const retainedAssignmentMigration =
  '20261120125319_feat_003_retained_instructor_assignment.sql';
const receiptPrefixDigest = '7e9f6584aeb6f97d04274be42ffe8afd5088e955bdf05ea1ae2c539daf485a0c';
const repositoryMigrationDigest =
  '0bdf380ef27d819c7c207a200c0099a94cc40c678003c4e16ee52a0f00c01c8c';
export function readLifecycleMigrations(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name === '.gitkeep') continue;
    if (!entry.isFile() || !/^\d{14}_[a-z0-9_]+\.sql$/.test(entry.name))
      throw new Error('Unexpected disposable migration source.');
    names.push(entry.name);
  }
  const hash = createHash('sha256');
  names.sort();
  if (names.at(-2) !== retainedReceiptMigration || names.at(-1) !== retainedAssignmentMigration)
    throw new Error('Disposable migration inventory mismatch.');
  const migrations = names.map((name) => {
    if (name === retainedReceiptMigration && hash.copy().digest('hex') !== lifecycleMigrationDigest)
      throw new Error('Disposable migration inventory mismatch.');
    if (name === retainedAssignmentMigration && hash.copy().digest('hex') !== receiptPrefixDigest)
      throw new Error('Disposable migration inventory mismatch.');
    const bytes = readFileSync(path.join(directory, name));
    const sql = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (sql.includes('\0')) throw new Error('Unexpected disposable migration content.');
    hash.update(name).update('\0').update(sql.replaceAll('\r\n', '\n')).update('\0');
    return { name, bytes };
  });
  if (hash.digest('hex') !== repositoryMigrationDigest)
    throw new Error('Disposable migration inventory mismatch.');
  // The retained staging receipt is source-verified, outside the disposable fixture's plan.
  return migrations.slice(0, -2);
}
