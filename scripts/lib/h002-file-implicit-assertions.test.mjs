import { describe, expect, it } from 'vitest';
import { assertFile, assertFileReplay } from './h002-file-implicit-assertions.mjs';
import { ids, tables, objectKey, cases } from './h002-file-implicit-fixture.mjs';

const empty = () => Object.fromEntries(tables.map((table) => [table, []]));
function staged() {
  const before = empty();
  const after = empty();
  after.stored_files.push({
    id: ids.file,
    organization_id: ids.org,
    aircraft_record_id: ids.aircraft,
    bucket_id: 'aircraft-documents',
    object_key: objectKey,
    display_name: 'Synthetic.pdf',
    generated_name: `${ids.file}.pdf`,
    media_type: 'application/pdf',
    size_bytes: 10,
    sha256_hash: 'a'.repeat(64),
    scan_state: 'staged',
    classification: 'restricted_aircraft_document',
    uploader_user_id: ids.actor,
    created_at: '2026-10-24T00:00:00Z',
    updated_at: '2026-10-24T00:00:00Z',
  });
  after.aircraft_document_events.push({
    id: 'event',
    occurred_at: '2026-10-24T00:00:00Z',
    organization_id: ids.org,
    actor_user_id: ids.actor,
    target_type: 'file',
    target_id: ids.file,
    event_name: 'aircraft_document.file_staged',
    outcome: 'success',
    reason_code: 'file_staged',
    correlation_id: ids.correlation,
    idempotency_key_hash: null,
    metadata: { mediaType: 'application/pdf', sizeBytes: 10, hash: 'a'.repeat(64) },
  });
  return {
    before,
    after,
    result: {
      decision: 'staged',
      correlationId: ids.correlation,
      fileId: ids.file,
      objectKey,
      scanState: 'staged',
    },
  };
}

describe('file implicit-wait evidence assertions', () => {
  it('freezes distinct cases including all completion outcomes and natural waits', () => {
    expect(cases).toHaveLength(20);
    expect(new Set(cases.map((test) => test.name)).size).toBe(20);
    expect(cases.filter((test) => test.action === 'complete')).toHaveLength(10);
    expect(cases.filter((test) => test.kind === 'unique')).toHaveLength(4);
    expect(cases.filter((test) => test.kind === 'foreign-key')).toHaveLength(3);
  });
  it('accepts exact staging effects and audit', () => {
    const { result, before, after } = staged();
    expect(() => assertFile({ action: 'stage' }, result, before, after, null, false)).not.toThrow();
  });
  it.each([
    [
      'wrong school',
      (v) => {
        v.after.stored_files[0].organization_id = 'foreign';
      },
    ],
    [
      'extra file',
      (v) => {
        v.after.stored_files.push({ id: 'foreign' });
      },
    ],
    [
      'modified document',
      (v) => {
        v.after.aircraft_documents.push({ id: 'changed' });
      },
    ],
    [
      'missing audit',
      (v) => {
        v.after.aircraft_document_events = [];
      },
    ],
    [
      'extra audit',
      (v) => {
        v.after.aircraft_document_events.push(v.after.aircraft_document_events[0]);
      },
    ],
    [
      'wrong audit actor',
      (v) => {
        v.after.aircraft_document_events[0].actor_user_id = ids.admin;
      },
    ],
    [
      'wrong audit metadata',
      (v) => {
        v.after.aircraft_document_events[0].metadata.sizeBytes = 11;
      },
    ],
    [
      'extra returned data',
      (v) => {
        v.result.privateData = 'unexpected';
      },
    ],
  ])('rejects %s', (_, change) => {
    const v = staged();
    change(v);
    expect(() =>
      assertFile({ action: 'stage' }, v.result, v.before, v.after, null, false),
    ).toThrow();
  });
  it('requires complete rollback on denial and excludes file identifiers', () => {
    const v = staged();
    const denied = { decision: 'unauthorized', correlationId: ids.correlation };
    expect(() =>
      assertFile({ action: 'stage' }, denied, v.before, v.before, null, true),
    ).not.toThrow();
    expect(() => assertFile({ action: 'stage' }, denied, v.before, v.after, null, true)).toThrow();
    expect(() =>
      assertFile(
        { action: 'stage' },
        { ...denied, fileId: ids.file },
        v.before,
        v.before,
        null,
        true,
      ),
    ).toThrow();
  });
  it('preserves an independently committed uniqueness peer on denial/conflict', () => {
    const before = empty();
    const peer = empty();
    peer.stored_files.push({ id: 'peer' });
    const test = { action: 'stage', kind: 'unique', commit: true };
    for (const denied of [true, false]) {
      const result = {
        decision: denied ? 'unauthorized' : 'state_conflict',
        correlationId: ids.correlation,
      };
      expect(() => assertFile(test, result, before, peer, peer, denied)).not.toThrow();
      expect(() => assertFile(test, result, before, before, peer, denied)).toThrow();
    }
  });
  it.each(['rejected', 'scan_failed', 'size-mismatch', 'hash-mismatch'])(
    'preserves non-clean %s replay conflicts without writes',
    (outcome) => {
      const snapshot = empty();
      const conflict = { decision: 'state_conflict', correlationId: ids.correlation };
      expect(() =>
        assertFileReplay({ action: 'complete', outcome }, {}, conflict, snapshot, snapshot),
      ).not.toThrow();
      expect(() =>
        assertFileReplay(
          { action: 'complete', outcome },
          {},
          { decision: 'completed' },
          snapshot,
          snapshot,
        ),
      ).toThrow();
    },
  );
  it('rejects duplicate side effects on clean replay', () => {
    const v = staged();
    expect(() =>
      assertFileReplay(
        { action: 'complete', outcome: 'clean' },
        v.result,
        v.result,
        v.before,
        v.after,
      ),
    ).toThrow();
  });

  it.each([
    ['clean', 'clean', 'completed', 'file_clean', 'success', 10, true],
    ['rejected', 'rejected', 'file_rejected', 'file_rejected', 'failed', 10, true],
    ['scan_failed', 'scan_failed', 'file_rejected', 'file_rejected', 'failed', 10, true],
    ['size-mismatch', 'rejected', 'file_rejected', 'file_rejected', 'failed', 11, true],
    ['hash-mismatch', 'rejected', 'file_rejected', 'file_rejected', 'failed', 10, false],
  ])(
    'accepts exact completion evidence for %s and rejects altered state',
    (outcome, state, decision, eventName, auditOutcome, sizeBytes, hashMatched) => {
      const v = staged();
      v.before.stored_files = structuredClone(v.after.stored_files);
      v.after.stored_files[0].scan_state = state;
      v.after.stored_files[0].updated_at = '2026-10-24T00:01:00Z';
      Object.assign(v.after.aircraft_document_events[0], {
        event_name: `aircraft_document.${eventName}`,
        outcome: auditOutcome,
        reason_code: state,
        metadata: { mediaType: 'application/pdf', sizeBytes, hashMatched },
      });
      const result = {
        decision,
        fileId: ids.file,
        scanState: state,
        correlationId: ids.correlation,
      };
      expect(() =>
        assertFile({ action: 'complete', outcome }, result, v.before, v.after, null, false),
      ).not.toThrow();
      v.after.stored_files[0].sha256_hash = 'b'.repeat(64);
      expect(() =>
        assertFile({ action: 'complete', outcome }, result, v.before, v.after, null, false),
      ).toThrow();
    },
  );

  it('requires a download audit without any file changes', () => {
    const v = staged();
    v.after.stored_files[0].scan_state = 'clean';
    v.before.stored_files = structuredClone(v.after.stored_files);
    Object.assign(v.after.aircraft_document_events[0], {
      event_name: 'aircraft_document.download_issued',
      reason_code: 'download_issued',
      metadata: { mediaType: 'application/pdf', sizeBytes: 10 },
    });
    const result = { decision: 'confirmed', fileId: ids.file, correlationId: ids.correlation };
    expect(() =>
      assertFile({ action: 'download' }, result, v.before, v.after, null, false),
    ).not.toThrow();
    v.after.stored_files[0].scan_state = 'rejected';
    expect(() =>
      assertFile({ action: 'download' }, result, v.before, v.after, null, false),
    ).toThrow();
  });
});
