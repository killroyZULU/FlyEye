import { describe, expect, it } from 'vitest';
import { assertRead, expectedResponse } from './h002-member-read-assertions.mjs';
import {
  cases,
  authorities,
  denied,
  tables,
  ids,
  lock,
  command,
} from './h002-member-read-fixture.mjs';

const time = '2026-10-01T00:00:00+00:00';
function fixture(family, student = false) {
  const before = Object.fromEntries(tables.map((table) => [table, []]));
  const context = {
    roles: [
      {
        id: 'admin',
        code: 'admin',
        display_name: 'Organization Admin',
        is_active: true,
        is_membership_assignable: true,
        required_assurance_level: 'aal2',
      },
      {
        id: 'student',
        code: 'student_pilot',
        display_name: 'Student Pilot',
        is_active: true,
        is_membership_assignable: true,
        required_assurance_level: 'aal1',
      },
      {
        id: 'instructor',
        code: 'instructor_pilot',
        display_name: 'Instructor Pilot',
        is_active: true,
        is_membership_assignable: true,
        required_assurance_level: 'aal2',
      },
    ],
    statusOptions: [
      { action: 'suspend', code: 'administrative_review', label: 'Administrative review' },
    ],
    roleReasons: [{ code: 'responsibility_changed', label: 'Responsibility changed' }],
  };
  for (const [id, role] of [
    [ids.member, student ? 'student' : 'admin'],
    [ids.adminMember, 'admin'],
    [ids.targetMember, 'instructor'],
  ]) {
    before.organization_memberships.push({
      id,
      status: 'active',
      version: 1,
      created_at: time,
      updated_at: time,
    });
    before.organization_member_profiles.push({
      membership_id: id,
      display_name: null,
      contact_number: null,
      version: 1,
    });
    before.membership_roles.push({ membership_id: id, role_id: role });
  }
  const test = { family },
    result = expectedResponse(test, before, context);
  const after = structuredClone(before);
  const eventName = {
    list: 'member_directory.listed',
    detail: 'member_directory.viewed',
    profile: 'member_profile.viewed',
  }[family];
  after.member_administration_events.push({
    id: ids.invitation,
    occurred_at: time,
    organization_id: ids.org,
    actor_user_id: ids.actor,
    target_membership_id:
      family === 'list' ? null : family === 'detail' ? ids.targetMember : ids.member,
    event_name: eventName,
    outcome: 'success',
    reason_code: eventName.replace('.', '_'),
    correlation_id: ids.correlation,
    idempotency_key_hash: null,
    metadata:
      family === 'list' ? { resultCount: 3, statusFiltered: false, searchApplied: false } : {},
  });
  return { test, result, before, after, context };
}
describe('audited member/profile read waits', () => {
  it('freezes 33 schedules: 18 denials and 15 retained controls with exact FK identities', () => {
    expect(cases).toHaveLength(11);
    const variants = cases.flatMap(authorities);
    expect(variants).toHaveLength(33);
    expect(variants.filter(denied)).toHaveLength(18);
    expect(variants.filter((value) => !denied(value))).toHaveLength(15);
    expect(lock({ family: 'detail', kind: 'membership' })).toContain(ids.targetMember);
    expect(lock({ family: 'profile', kind: 'membership' })).toContain(ids.member);
    expect(lock({ family: 'profile', kind: 'actor' })).toContain(ids.actor);
    expect(command({ family: 'profile' })).not.toContain(ids.targetMember);
  });
  it.each(['list', 'detail', 'profile'])(
    'accepts exact %s results and one minimized event',
    (family) => {
      const f = fixture(family);
      expect(() => assertRead(f.test, f.result, f.before, f.after, false, f.context)).not.toThrow();
    },
  );
  it('preserves null fields, ordered directory entries, detail options and student own access', () => {
    const list = fixture('list');
    expect(list.result.members.map((m) => m.membershipId)).toEqual([
      ids.targetMember,
      ids.adminMember,
      ids.member,
    ]);
    expect(list.result.members[0]).toMatchObject({
      displayName: null,
      profileVersion: 1,
      profileComplete: false,
    });
    const detail = fixture('detail');
    expect(detail.result.member.roleOptions).toEqual([
      { code: 'admin', label: 'Organization Admin', requiresMfa: true },
      { code: 'student_pilot', label: 'Student Pilot', requiresMfa: false },
    ]);
    const f = fixture('profile', true);
    expect(f.result.profile).toMatchObject({
      roleCode: 'student_pilot',
      complete: false,
      contactNumber: null,
    });
    expect(() => assertRead(f.test, f.result, f.before, f.after, false, f.context)).not.toThrow();
  });
  it.each(['list', 'detail', 'profile'])(
    'requires non-disclosing %s denial and complete rollback',
    (family) => {
      const f = fixture(family),
        result = { decision: 'not_found', correlationId: ids.correlation };
      expect(() => assertRead(f.test, result, f.before, f.before, true)).not.toThrow();
      expect(() =>
        assertRead(f.test, { ...result, payload: {} }, f.before, f.before, true),
      ).toThrow();
      for (const table of tables) {
        const after = structuredClone(f.before);
        after[table].push({ id: 'unexpected' });
        expect(() => assertRead(f.test, result, f.before, after, true)).toThrow();
      }
    },
  );
  it.each([
    'actor_user_id',
    'target_membership_id',
    'event_name',
    'outcome',
    'reason_code',
    'metadata',
    'correlation_id',
    'idempotency_key_hash',
  ])('rejects incorrect audit %s', (field) => {
    const f = fixture('detail');
    f.after.member_administration_events[0][field] = 'unexpected';
    expect(() => assertRead(f.test, f.result, f.before, f.after, false, f.context)).toThrow();
  });
  it.each(['list', 'detail', 'profile'])(
    'rejects missing/extra events and data disclosure for %s',
    (family) => {
      const f = fixture(family);
      expect(() =>
        assertRead(
          f.test,
          { ...f.result, privateData: 'extra' },
          f.before,
          f.after,
          false,
          f.context,
        ),
      ).toThrow();
      expect(() => assertRead(f.test, f.result, f.before, f.before, false, f.context)).toThrow();
      f.after.member_administration_events.push({
        ...f.after.member_administration_events[0],
        id: ids.operation,
      });
      expect(() => assertRead(f.test, f.result, f.before, f.after, false, f.context)).toThrow();
    },
  );
  it('requires one new event on a successful explicit retry and preserves prior evidence', () => {
    const f = fixture('profile');
    const after = structuredClone(f.after);
    after.member_administration_events.push({
      ...after.member_administration_events[0],
      id: ids.operation,
    });
    expect(() => assertRead(f.test, f.result, f.after, after, false, f.context)).not.toThrow();
    after.member_administration_events[0].metadata = { changed: true };
    expect(() => assertRead(f.test, f.result, f.after, after, false, f.context)).toThrow();
  });
  it('distinguishes surviving access audit from disclosure after complete rollback', () => {
    const f = fixture('profile');
    for (const [after, evidence] of [
      [f.after, 'rollback'],
      [f.before, 'response-after-verified-rollback'],
    ]) {
      try {
        assertRead(f.test, f.result, f.before, after, true);
        expect.fail('Expected denial failure');
      } catch (error) {
        expect(error.evidence).toBe(evidence);
      }
    }
  });
});
