// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { feat003StagingTarget } from '../../config/feat-003-staging-target.mjs';
import { retainedReceiptMigration } from './local-lifecycle-migrations.mjs';

// These checks inspect source declarations. Effective privileges and database behavior
// require a separately authorized disposable migration run.
function migration(name) {
  return readFileSync(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8')
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const sql = migration(retainedReceiptMigration);
const table = 'staging_private.retained_membership_receipts';
const ddl = sql.split('create table ' + table + ' (')[1].split(');')[0];
const uniqueKeys = [...ddl.matchAll(/(\w+) uuid (?:not null unique|primary key)\b/g)].map(
  (match) => [match[1]],
);
for (const match of ddl.matchAll(/\bunique \(([\w, ]+)\)/g)) uniqueKeys.push(match[1].split(', '));

const student = {
  operation_id: 'op-s',
  attempt_id: 'attempt-s',
  run_id: 'one-run',
  organization_id: 'one-school',
  user_id: 'user-s',
  membership_id: 'member-s',
  profile_id: 'profile-s',
  slot_code: 'student_pilot',
  initial_role_code: 'student_pilot',
};
const candidate = {
  ...student,
  operation_id: 'op-i',
  attempt_id: 'attempt-i',
  user_id: 'user-i',
  membership_id: 'member-i',
  profile_id: 'profile-i',
  slot_code: 'instructor_pilot',
};
function collisions(other) {
  return uniqueKeys.filter((key) => key.every((field) => student[field] === other[field]));
}

describe('retained membership receipt SQL contract', () => {
  it('permits both initially-Student slots in the same run and school', () => {
    expect(ddl).toContain(
      "slot_code text not null check (slot_code in ('student_pilot', 'instructor_pilot'))",
    );
    expect(ddl).toContain(
      "initial_role_code text not null check (initial_role_code = 'student_pilot')",
    );
    expect(ddl).toContain('run_id uuid not null,');
    expect(uniqueKeys).toEqual([
      ['operation_id'],
      ['attempt_id'],
      ['user_id'],
      ['membership_id'],
      ['profile_id'],
      ['organization_id', 'slot_code'],
    ]);
    expect(collisions(candidate)).toEqual([]);
  });

  it.each(['operation_id', 'attempt_id', 'user_id', 'membership_id', 'profile_id', 'slot_code'])(
    'declares a conflict when %s is reused across independently journalled rows',
    (field) => {
      const duplicate = { ...candidate, run_id: 'later-run', [field]: student[field] };
      expect(collisions(duplicate)).toEqual([
        field === 'slot_code' ? ['organization_id', field] : [field],
      ]);
    },
  );

  it('binds the receipt to its school, Auth subject, membership and exact profile together', () => {
    expect(ddl).toContain('organization_id uuid not null,');
    for (const [parent, subject, columns] of [
      ['organization_memberships', 'user_id', 'organization_id, id, user_id'],
      ['organization_member_profiles', 'profile_id', 'organization_id, membership_id, id'],
    ]) {
      expect(ddl).toContain(
        'foreign key (organization_id, membership_id, ' +
          subject +
          ') references public.' +
          parent +
          ' (' +
          columns +
          ')',
      );
      expect(sql).toMatch(
        new RegExp('create unique index \\w+ on public\\.' + parent + ' \\(' + columns + '\\);'),
      );
    }
    const identity = migration('20260719000100_feat_001_identity_rbac.sql');
    expect(identity).toContain(
      'user_id uuid not null references auth.users(id) on delete restrict',
    );
    expect(sql).not.toMatch(/on (?:delete|update) cascade/);
  });

  it('pins the target and requires database, package and nonhuman event provenance', () => {
    expect(ddl).toContain(
      "project_ref text not null check (project_ref = '" + feat003StagingTarget.projectRef + "')",
    );
    expect(ddl).toContain("package_sha256 text not null check (package_sha256 ~ '^[0-9a-f]{64}$')");
    expect(ddl).toContain(
      "database_system_id text not null check (database_system_id ~ '^[0-9]{1,20}$')",
    );
    expect(ddl).toContain(
      "event_name text not null check (event_name = 'fixture.retained_membership_established')",
    );
    expect(ddl).toContain('occurred_at timestamptz not null default transaction_timestamp()');
  });

  it('declares private append-only storage without opening an application write path', () => {
    expect(sql.startsWith('begin;')).toBe(true);
    expect(sql.endsWith('commit;')).toBe(true);
    expect(sql).toContain('alter table ' + table + ' enable row level security;');
    expect(sql).toContain(
      'revoke all on table ' +
        table +
        ' from public, anon, authenticated, service_role, supabase_auth_admin;',
    );
    expect(sql).toContain(
      'before update or delete or truncate on ' +
        table +
        ' for each statement execute function staging_private.reject_student_receipt_change();',
    );
    const prior = migration('20261118084658_feat_003_local_student_fixture_receipt.sql');
    expect(prior).toContain(
      "begin raise exception 'Student fixture receipts are append-only.'; end;",
    );
    expect(sql).not.toMatch(
      /\b(grant|create policy|security definer|create function|insert into|drop|disable trigger)\b/i,
    );
  });
});
