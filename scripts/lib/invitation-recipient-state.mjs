import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export const quote = (value) => `'${value.replaceAll("'", "''")}'`;
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export function seedInvitation(psql, org, admin, email) {
  const id = randomUUID();
  psql(`insert into public.organization_invitations(id,organization_id,email_original,email_canonical,
    role_id,status,invited_by,issuance_idempotency_key_hash,correlation_id,provider_operation_class,
    delivery_operation_id,delivery_outcome,delivery_attempt_count,last_delivery_attempt_at)
    select ${quote(id)},${quote(org)},${quote(email)},${quote(email)},id,'pending',${quote(admin)},
    ${quote(hash(id))},${quote(randomUUID())},'existing_identity_sign_in',${quote(randomUUID())},'accepted',1,now()
    from public.roles where code='student_pilot';`);
  return id;
}
export function snapshot(psql, actor, invitation) {
  const user = quote(actor.id);
  return JSON.parse(
    psql(`select jsonb_build_object(
    'invitation',(select to_jsonb(i) from public.organization_invitations i where id=${quote(invitation)}),
    'members',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]') from public.organization_memberships m where user_id=${user}),
    'roles',(select coalesce(jsonb_agg(to_jsonb(r) order by membership_id,role_id),'[]') from public.membership_roles r
      where membership_id in (select id from public.organization_memberships where user_id=${user})),
    'profiles',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.organization_member_profiles p
      where membership_id in (select id from public.organization_memberships where user_id=${user})),
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from public.member_invitation_events e where actor_user_id=${user} or invitation_id=${quote(invitation)}));`),
  );
}
export function assertDenied(before, after, actor, correlation) {
  for (const field of ['invitation', 'members', 'roles', 'profiles'])
    assert.deepEqual(after[field], before[field]);
  const prior = new Set(before.events.map((event) => event.id));
  assert.deepEqual(
    after.events.filter((event) => prior.has(event.id)),
    before.events,
  );
  const added = after.events.filter((event) => !prior.has(event.id));
  assert.equal(added.length, 1);
  const { id, created_at, occurred_at, ...event } = added[0];
  assert.ok(id);
  // Event timestamps are database-owned; compare all semantic audit fields.
  assert.deepEqual(event, {
    organization_id: before.invitation.organization_id,
    invitation_id: before.invitation.id,
    actor_user_id: actor.id,
    event_name: 'member_invitation.denied',
    outcome: 'denied',
    reason_code: 'invitation_not_available',
    correlation_id: correlation,
    idempotency_key_hash: null,
    metadata: {},
  });
  assert.ok(created_at || occurred_at);
}
export function assertAccepted(before, after, actor, result, key) {
  assert.equal(result.decision, 'accepted');
  assert.equal(result.replayed, false);
  assert.equal(result.version, 2);
  assert.equal(before.members.length, 0);
  assert.equal(after.members.length, 1);
  assert.equal(after.roles.length, 1);
  assert.equal(after.profiles.length, 1);
  const member = after.members[0];
  assert.equal(member.id, result.membershipId);
  assert.equal(member.user_id, actor.id);
  assert.equal(member.organization_id, before.invitation.organization_id);
  assert.equal(member.status, 'active');
  assert.equal(member.created_by, actor.id);
  assert.equal(member.updated_by, actor.id);
  assert.equal(result.organizationId, member.organization_id);
  assert.equal(result.invitationId, before.invitation.id);
  assert.deepEqual(
    after.roles.map(({ organization_id, membership_id, role_id, assigned_by }) => ({
      organization_id,
      membership_id,
      role_id,
      assigned_by,
    })),
    [
      {
        organization_id: member.organization_id,
        membership_id: member.id,
        role_id: before.invitation.role_id,
        assigned_by: actor.id,
      },
    ],
  );
  assert.equal(after.profiles[0].membership_id, member.id);
  assert.equal(after.profiles[0].organization_id, member.organization_id);
  assert.equal(after.profiles[0].created_by, actor.id);
  assert.equal(after.profiles[0].updated_by, actor.id);
  assert.equal(after.profiles[0].version, 1);
  assert.equal(after.profiles[0].display_name, null);
  assert.equal(after.profiles[0].contact_number, null);
  const expected = {
    ...before.invitation,
    status: 'accepted',
    version: 2,
    accepted_by: actor.id,
    accepted_membership_id: member.id,
    acceptance_idempotency_key_hash: hash(key),
    accepted_at: after.invitation.accepted_at,
    updated_at: after.invitation.updated_at,
  };
  assert.ok(after.invitation.accepted_at);
  assert.deepEqual(after.invitation, expected);
  const prior = new Set(before.events.map((event) => event.id));
  assert.deepEqual(
    after.events.filter((event) => prior.has(event.id)),
    before.events,
  );
  const added = after.events.filter((event) => !prior.has(event.id));
  assert.equal(added.length, 1);
  const event = added[0];
  assert.equal(event.event_name, 'member_invitation.accepted');
  assert.equal(event.outcome, 'success');
  assert.equal(event.reason_code, 'membership_created');
  assert.equal(event.organization_id, member.organization_id);
  assert.equal(event.invitation_id, before.invitation.id);
  assert.equal(event.actor_user_id, actor.id);
  assert.equal(event.correlation_id, result.correlationId);
  assert.equal(event.idempotency_key_hash, hash(key));
  assert.deepEqual(event.metadata, {
    invitationVersion: 2,
    membershipId: member.id,
    roleId: before.invitation.role_id,
  });
}

export function foreignSnapshot(psql, actors, invitations) {
  const users = actors.map((actor) => quote(actor.id)).join(',');
  const excluded = invitations.map(quote).join(',');
  return psql(`select jsonb_build_array(
    (select jsonb_agg(to_jsonb(m) order by id) from public.organization_memberships m where user_id not in (${users})),
    (select jsonb_agg(to_jsonb(p) order by id) from public.organization_member_profiles p where membership_id not in
      (select id from public.organization_memberships where user_id in (${users}))),
    (select jsonb_agg(to_jsonb(r) order by membership_id,role_id) from public.membership_roles r where membership_id not in
      (select id from public.organization_memberships where user_id in (${users}))),
    (select jsonb_agg(to_jsonb(i) order by id) from public.organization_invitations i where id not in (${excluded})),
    (select jsonb_agg(to_jsonb(e) order by id) from public.member_invitation_events e where actor_user_id not in (${users})),
    (select jsonb_agg(to_jsonb(r) order by id) from public.roles r),
    (select jsonb_agg(to_jsonb(p) order by role_id,permission_id) from public.role_permissions p));`);
}
