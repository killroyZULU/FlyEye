import { describe, expect, it } from 'vitest';
import { assertMfaCompletionAudit } from './member-mfa-browser-evidence.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const scope = {
  userId: id,
  organizationId: id,
  membershipId: id,
  operation: { id, factor_reference_hash: 'f'.repeat(64) },
};
function event() {
  return {
    id,
    occurred_at: '2026-10-13T00:00:00Z',
    source_code: null,
    source_instance_id: null,
    organization_id: id,
    organization_ids: [id],
    actor_user_id: id,
    actor_subject_id: id,
    actor_kind: 'authenticated_subject',
    event_name: 'member_mfa.enrollment_completed',
    outcome: 'success',
    correlation_id: id,
    reason_code: 'enrollment_completed',
    target_kind: 'member_mfa_enrollment_operation',
    target_id: id,
    idempotency_key_hash: 'a'.repeat(64),
    metadata: { membershipId: id, factorReferenceHash: 'f'.repeat(64), readinessVersion: 1 },
  };
}
describe('provider browser completion audit evidence', () => {
  it('accepts exact scoped evidence and rejects corrupted attribution or metadata', () => {
    expect(() => assertMfaCompletionAudit(event(), scope)).not.toThrow();
    for (const patch of [
      { actor_user_id: null },
      { actor_kind: 'system' },
      { organization_ids: [] },
      { target_kind: 'wrong' },
      { reason_code: 'wrong' },
      { metadata: { ...event().metadata, factorReferenceHash: 'e'.repeat(64) } },
      { metadata: { ...event().metadata, readinessVersion: 2 } },
      { metadata: { ...event().metadata, unexpected: true } },
      { source_code: 'unexpected' },
      { correlation_id: 'invalid' },
    ])
      expect(() => assertMfaCompletionAudit({ ...event(), ...patch }, scope)).toThrow();
  });
});
