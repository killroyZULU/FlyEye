import { describe, expect, it } from 'vitest';
import { assertDocument, assertReplay } from './h002-document-implicit-assertions.mjs';
import { cases, tables, ids, label } from './h002-document-implicit-fixture.mjs';

const time = '2026-10-01T00:00:00+00:00';
const later = '2026-10-01T00:00:01+00:00';
const empty = () => Object.fromEntries(tables.map((table) => [table, []]));
const denial = { decision: 'unauthorized', correlationId: ids.correlation };
function rename() {
  const before = empty();
  before.aircraft_document_categories.push({
    id: ids.category,
    organization_id: ids.org,
    category_code: 'custom_h002',
    category_label: 'Synthetic review',
    category_kind: 'custom',
    category_state: 'active',
    version: 1,
    created_at: time,
    created_by: ids.admin,
    updated_at: time,
    updated_by: ids.admin,
    archived_at: null,
    archived_by: null,
  });
  const after = structuredClone(before);
  Object.assign(after.aircraft_document_categories[0], {
    category_label: label,
    version: 2,
    updated_at: later,
    updated_by: ids.actor,
  });
  const payload = {
    decision: 'category_renamed',
    categoryId: ids.category,
    categoryCode: 'custom_h002',
    categoryLabel: label,
    categoryState: 'active',
    categoryVersion: 2,
    requirementId: null,
    requirementVersion: null,
    replayed: false,
  };
  const result = { ...payload, correlationId: ids.correlation };
  after.aircraft_document_events.push({
    id: ids.operation,
    organization_id: ids.org,
    actor_user_id: ids.actor,
    target_type: 'category',
    target_id: ids.category,
    event_name: 'aircraft_document.category_renamed',
    outcome: 'success',
    reason_code: 'category_renamed',
    correlation_id: ids.correlation,
    idempotency_key_hash: 'a'.repeat(64),
    occurred_at: later,
    metadata: {
      categoryId: ids.category,
      aircraftId: null,
      categoryVersion: 2,
      requirementVersion: null,
    },
  });
  after.aircraft_document_idempotency.push({
    organization_id: ids.org,
    actor_user_id: ids.actor,
    idempotency_key_hash: 'a'.repeat(64),
    action: 'rename_category',
    target_id: ids.category,
    expected_version: 1,
    request_hash: 'b'.repeat(64),
    result: payload,
    created_at: later,
  });
  return {
    before,
    after,
    result,
    test: { family: 'category', action: 'rename_category', kind: 'domain' },
  };
}
describe('document/category implicit-wait evidence assertions', () => {
  it('distinguishes rollback failure from response failure after verified rollback', () => {
    const before = empty(),
      after = empty();
    after.stored_files.push({ id: ids.file });
    try {
      assertDocument({ kind: 'domain' }, denial, before, after, undefined, true);
      expect.fail('Expected rollback rejection');
    } catch (error) {
      expect(error.evidence).toBe('rollback');
    }
    try {
      assertDocument(
        { kind: 'domain' },
        { decision: 'state_conflict', correlationId: ids.correlation },
        before,
        before,
        undefined,
        true,
      );
      expect.fail('Expected response rejection');
    } catch (error) {
      expect(error.evidence).toBe('response-after-verified-rollback');
    }
  });
  it('freezes 81 distinct barriers and 243 authority schedules', () => {
    expect(cases).toHaveLength(81);
    expect(new Set(cases.map((test) => test.name)).size).toBe(81);
    expect(cases.length * 3).toBe(243);
  });
  it('accepts exact denial and retains an independently committed peer', () => {
    const before = empty(),
      peer = empty();
    peer.stored_files.push({ id: ids.file });
    expect(() =>
      assertDocument({ kind: 'domain' }, denial, before, before, undefined, true),
    ).not.toThrow();
    expect(() =>
      assertDocument(
        { kind: 'unique-idempotency', commit: true },
        denial,
        before,
        peer,
        peer,
        true,
      ),
    ).not.toThrow();
  });
  it.each(tables)('rejects surviving denied writes to %s', (table) => {
    const before = empty(),
      after = empty();
    after[table].push({ id: ids.file });
    expect(() =>
      assertDocument({ kind: 'domain' }, denial, before, after, undefined, true),
    ).toThrow();
  });
  it('does not accept a conflict as an authorized denial', () => {
    expect(() =>
      assertDocument(
        { kind: 'unique-label', commit: true },
        { decision: 'state_conflict', correlationId: ids.correlation },
        empty(),
        empty(),
        empty(),
        true,
      ),
    ).toThrow();
  });
  it('accepts a complete retained-authority rename and exact replay', () => {
    const { test, result, before, after } = rename();
    expect(() => assertDocument(test, result, before, after, undefined, false)).not.toThrow();
    expect(() => assertReplay(result, { ...result, replayed: true }, after, after)).not.toThrow();
  });
  it.each([
    [
      'category version',
      (state) => {
        state.aircraft_document_categories[0].version = 3;
      },
    ],
    [
      'category label',
      (state) => {
        state.aircraft_document_categories[0].category_label = 'Other';
      },
    ],
    [
      'audit actor',
      (state) => {
        state.aircraft_document_events[0].actor_user_id = ids.admin;
      },
    ],
    [
      'audit metadata',
      (state) => {
        state.aircraft_document_events[0].metadata.categoryVersion = 3;
      },
    ],
    [
      'missing audit',
      (state) => {
        state.aircraft_document_events = [];
      },
    ],
    [
      'extra notification',
      (state) => {
        state.aircraft_document_notifications.push({ id: ids.notification });
      },
    ],
    [
      'unrelated file',
      (state) => {
        state.stored_files.push({ id: ids.file });
      },
    ],
    [
      'idempotency result',
      (state) => {
        state.aircraft_document_idempotency[0].result.replayed = true;
      },
    ],
  ])('rejects corrupted positive evidence: %s', (_, mutate) => {
    const { test, result, before, after } = rename();
    mutate(after);
    expect(() => assertDocument(test, result, before, after, undefined, false)).toThrow();
  });
  it('rejects replay writes or a non-replay result', () => {
    const { result, after } = rename();
    const changed = structuredClone(after);
    changed.stored_files.push({ id: ids.file });
    expect(() => assertReplay(result, { ...result, replayed: true }, after, changed)).toThrow();
    expect(() => assertReplay(result, result, after, after)).toThrow();
  });
});
