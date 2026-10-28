import assert from 'node:assert/strict';
import { ids, tables } from './h002-member-read-fixture.mjs';

const sorted = (rows) =>
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function unchanged(before, after) {
  for (const table of tables) assert.deepEqual(sorted(after[table]), sorted(before[table]));
}
function member(state, id, context) {
  const m = state.organization_memberships.find((row) => row.id === id);
  const p = state.organization_member_profiles.find((row) => row.membership_id === id);
  const link = state.membership_roles.find((row) => row.membership_id === id);
  const role = context.roles.find((row) => row.id === link.role_id);
  const subject = id === ids.member ? 'actor' : id === ids.adminMember ? 'admin' : 'target';
  return {
    m,
    p,
    role,
    data: {
      membershipId: m.id,
      displayName: p.display_name,
      email: `h002-review-${subject}@example.test`,
      roleCode: role.code,
      roleLabel: role.display_name,
      status: m.status,
      membershipVersion: m.version,
      profileVersion: p.version,
      profileComplete: p.display_name !== null,
      createdAt: m.created_at,
    },
  };
}
export function expectedResponse(test, state, context) {
  const common = { decision: 'found', correlationId: ids.correlation };
  if (test.family === 'list') {
    const members = state.organization_memberships
      .map((row) => member(state, row.id, context).data)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.membershipId.localeCompare(a.membershipId),
      );
    return { ...common, decision: 'listed', organizationId: ids.org, members, hasMore: false };
  }
  const { m, p, role, data } = member(
    state,
    test.family === 'detail' ? ids.targetMember : ids.member,
    context,
  );
  if (test.family === 'detail')
    return {
      ...common,
      organizationId: ids.org,
      member: {
        ...data,
        contactNumber: p.contact_number,
        updatedAt: m.updated_at,
        statusReasonOptions: context.statusOptions,
        roleOptions: context.roles
          .filter((r) => r.is_active && r.is_membership_assignable && r.id !== role.id)
          .map((r) => ({
            code: r.code,
            label: r.display_name,
            requiresMfa: r.required_assurance_level === 'aal2',
          })),
        roleReasonOptions: context.roleReasons,
      },
    };
  return {
    ...common,
    profile: {
      organizationId: ids.org,
      organizationName: 'Synthetic H002 review',
      membershipId: m.id,
      displayName: p.display_name,
      contactNumber: p.contact_number,
      email: data.email,
      roleCode: role.code,
      roleLabel: role.display_name,
      status: m.status,
      version: p.version,
      complete: p.display_name !== null,
    },
  };
}
export function assertRead(test, result, before, after, denied, context) {
  if (denied) {
    let evidence = 'rollback';
    try {
      unchanged(before, after);
      evidence = 'response-after-verified-rollback';
      assert.deepEqual(result, { decision: 'not_found', correlationId: ids.correlation });
    } catch (error) {
      error.evidence = evidence;
      throw error;
    }
    return;
  }
  assert.deepEqual(result, expectedResponse(test, before, context));
  const expected = structuredClone(before);
  const prior = new Set(before.member_administration_events.map((row) => row.id));
  const added = after.member_administration_events.filter((row) => !prior.has(row.id));
  assert.equal(added.length, 1);
  const event = added[0];
  assert.match(event.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(
    typeof event.occurred_at === 'string' && Number.isFinite(Date.parse(event.occurred_at)),
  );
  const eventName = {
    list: 'member_directory.listed',
    detail: 'member_directory.viewed',
    profile: 'member_profile.viewed',
  }[test.family];
  expected.member_administration_events.push({
    id: event.id,
    occurred_at: event.occurred_at,
    organization_id: ids.org,
    actor_user_id: ids.actor,
    target_membership_id:
      test.family === 'list' ? null : test.family === 'detail' ? ids.targetMember : ids.member,
    event_name: eventName,
    outcome: 'success',
    reason_code: eventName.replace('.', '_'),
    correlation_id: ids.correlation,
    idempotency_key_hash: null,
    metadata:
      test.family === 'list'
        ? { resultCount: result.members.length, statusFiltered: false, searchApplied: false }
        : {},
  });
  unchanged(expected, after);
}
