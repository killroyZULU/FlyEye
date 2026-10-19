import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requestSchema } from '../../supabase/functions/member-invitations/contracts.ts';
import {
  acceptanceRequest,
  assertDenied,
  assertAccepted,
  hash,
} from './invitation-recipient-state.mjs';

describe('recipient acceptance fixture request contract', () => {
  it('passes the production schema and preserves the same request key for replay', () => {
    const request = acceptanceRequest(randomUUID());
    expect(requestSchema.parse(request)).toEqual(request);
    expect(acceptanceRequest(request.invitationId, request.idempotencyKey)).toEqual(request);
    expect(acceptanceRequest(request.invitationId).idempotencyKey).not.toBe(request.idempotencyKey);
  });

  it('reproduces rejection of the UUID-formatted key before acceptance can execute', () => {
    const request = acceptanceRequest(randomUUID(), randomUUID());
    const result = requestSchema.safeParse(request);
    expect(result.success).toBe(false);
    expect(result.error.issues.map(({ path }) => path)).toEqual([['idempotencyKey']]);
  });
});

const actor = { id: 'recipient' };
function state() {
  return {
    invitation: {
      id: 'invite',
      organization_id: 'school',
      role_id: 'student',
      status: 'pending',
      version: 1,
    },
    members: [],
    roles: [],
    profiles: [],
    events: [],
  };
}
function denial() {
  const before = state();
  const after = structuredClone(before);
  after.events.push({
    id: 'audit',
    occurred_at: 'database-time',
    organization_id: 'school',
    invitation_id: 'invite',
    actor_user_id: actor.id,
    event_name: 'member_invitation.denied',
    outcome: 'denied',
    reason_code: 'invitation_not_available',
    correlation_id: 'correlation',
    idempotency_key_hash: null,
    metadata: {},
  });
  return { before, after };
}
function success() {
  const before = state();
  const after = structuredClone(before);
  const result = {
    decision: 'accepted',
    replayed: false,
    version: 2,
    organizationId: 'school',
    invitationId: 'invite',
    membershipId: 'member',
    correlationId: 'correlation',
  };
  after.members.push({
    id: 'member',
    user_id: actor.id,
    organization_id: 'school',
    status: 'active',
    created_by: actor.id,
    updated_by: actor.id,
  });
  after.roles.push({
    organization_id: 'school',
    membership_id: 'member',
    role_id: 'student',
    assigned_by: actor.id,
  });
  after.profiles.push({
    organization_id: 'school',
    membership_id: 'member',
    created_by: actor.id,
    updated_by: actor.id,
    version: 1,
    display_name: null,
    contact_number: null,
  });
  Object.assign(after.invitation, {
    status: 'accepted',
    version: 2,
    accepted_by: actor.id,
    accepted_membership_id: 'member',
    acceptance_idempotency_key_hash: hash('key'),
    accepted_at: 'database-time',
    updated_at: 'database-time',
  });
  after.events.push({
    event_name: 'member_invitation.accepted',
    outcome: 'success',
    reason_code: 'membership_created',
    organization_id: 'school',
    invitation_id: 'invite',
    actor_user_id: actor.id,
    correlation_id: 'correlation',
    idempotency_key_hash: hash('key'),
    metadata: { invitationVersion: 2, membershipId: 'member', roleId: 'student' },
  });
  return { before, after, result };
}
describe('provider recipient evidence', () => {
  it('preserves prior denial events when a fresh invitation succeeds', () => {
    const s = success();
    const prior = { ...denial().after.events[0], id: 'prior', invitation_id: 'old-invitation' };
    s.before.events.push(prior);
    s.after.events.push(structuredClone(prior));
    expect(() => assertAccepted(s.before, s.after, actor, s.result, 'key')).not.toThrow();
    s.after.events[1].reason_code = 'changed';
    expect(() => assertAccepted(s.before, s.after, actor, s.result, 'key')).toThrow();
  });
  it('rejects extra same-actor events with a wrong or null invitation', () => {
    for (const invitation of [null, 'wrong-invitation']) {
      const d = denial();
      d.after.events.push({ ...d.after.events[0], id: 'extra', invitation_id: invitation });
      expect(() => assertDenied(d.before, d.after, actor, 'correlation')).toThrow();
      const s = success();
      s.after.events.push({ ...s.after.events[0], id: 'extra', invitation_id: invitation });
      expect(() => assertAccepted(s.before, s.after, actor, s.result, 'key')).toThrow();
    }
  });
  it('accepts exact denial and positive authority evidence', () => {
    const d = denial();
    expect(() => assertDenied(d.before, d.after, actor, 'correlation')).not.toThrow();
    const s = success();
    expect(() => assertAccepted(s.before, s.after, actor, s.result, 'key')).not.toThrow();
  });
  it.each([
    [
      'missing denial audit',
      (x) => {
        x.after.events = [];
      },
    ],
    [
      'wrong school audit',
      (x) => {
        x.after.events[0].organization_id = 'foreign';
      },
    ],
    [
      'unaudited prior change',
      (x) => {
        x.before.events.push({ id: 'prior' });
      },
    ],
    [
      'unexpected profile',
      (x) => {
        x.after.profiles.push({ membership_id: 'other' });
      },
    ],
    [
      'new authority',
      (x) => {
        x.after.members.push({ id: 'other' });
      },
    ],
    [
      'changed invitation',
      (x) => {
        x.after.invitation.version = 2;
      },
    ],
  ])('rejects %s', (_, mutate) => {
    const x = denial();
    mutate(x);
    expect(() => assertDenied(x.before, x.after, actor, 'correlation')).toThrow();
  });
  it.each([
    [
      'excess role',
      (x) => {
        x.after.roles.push(x.after.roles[0]);
      },
    ],
    [
      'elevated role',
      (x) => {
        x.after.roles[0].role_id = 'admin';
      },
    ],
    [
      'foreign profile',
      (x) => {
        x.after.profiles[0].organization_id = 'foreign';
      },
    ],
    [
      'missing profile',
      (x) => {
        x.after.profiles = [];
      },
    ],
    [
      'missing acceptance audit',
      (x) => {
        x.after.events = [];
      },
    ],
    [
      'wrong audit key',
      (x) => {
        x.after.events[0].idempotency_key_hash = hash('other');
      },
    ],
    [
      'changed invitation expiry',
      (x) => {
        x.after.invitation.expires_at = 'later';
      },
    ],
    [
      'replayed initial acceptance',
      (x) => {
        x.result.replayed = true;
      },
    ],
    [
      'wrong audit membership',
      (x) => {
        x.after.events[0].metadata.membershipId = 'other';
      },
    ],
  ])('rejects %s', (_, mutate) => {
    const x = success();
    mutate(x);
    expect(() => assertAccepted(x.before, x.after, actor, x.result, 'key')).toThrow();
  });
});
