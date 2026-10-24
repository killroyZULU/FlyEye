import assert from 'node:assert/strict';
import { ids, tables, objectKey, finalState } from './h002-file-implicit-fixture.mjs';

export function assertFile(test, result, before, after, peerState, denied) {
  const baseline = test.kind === 'unique' && test.commit ? peerState : before;
  const conflict = test.kind === 'unique' && test.commit;
  const state = test.action === 'stage' ? 'staged' : finalState(test);
  const decision = denied
    ? 'unauthorized'
    : conflict
      ? 'state_conflict'
      : test.action === 'stage'
        ? 'staged'
        : test.action === 'download'
          ? 'confirmed'
          : state === 'clean'
            ? 'completed'
            : 'file_rejected';
  assert.deepEqual(result, {
    decision,
    correlationId: ids.correlation,
    ...(!denied && !conflict ? { fileId: ids.file } : {}),
    ...(!denied && !conflict && test.action !== 'download' ? { scanState: state } : {}),
    ...(!denied && !conflict && test.action === 'stage' ? { objectKey } : {}),
  });
  if (denied || conflict) {
    assert.deepEqual(after, baseline);
    return;
  }
  for (const table of tables.filter(
    (name) => !['stored_files', 'aircraft_document_events'].includes(name),
  ))
    assert.deepEqual(after[table], before[table]);
  assert.deepEqual(
    after.stored_files.filter((row) => row.id !== ids.file),
    baseline.stored_files.filter((row) => row.id !== ids.file),
  );
  if (test.action === 'download') assert.deepEqual(after.stored_files, before.stored_files);
  else {
    const file = after.stored_files.find((row) => row.id === ids.file);
    assert.ok(file);
    const prior = before.stored_files.find((row) => row.id === ids.file);
    const expected =
      test.action === 'stage'
        ? {
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
            classification: 'restricted_aircraft_document',
            uploader_user_id: ids.actor,
            created_at: file.created_at,
          }
        : { ...prior };
    assert.deepEqual(file, { ...expected, scan_state: state, updated_at: file.updated_at });
    assert.ok(file.created_at && file.updated_at);
    if (test.action === 'stage') assert.equal(file.created_at, file.updated_at);
  }
  assert.equal(after.aircraft_document_events.length, before.aircraft_document_events.length + 1);
  const priorIds = new Set(before.aircraft_document_events.map((row) => row.id));
  assert.deepEqual(
    after.aircraft_document_events.filter((row) => priorIds.has(row.id)),
    before.aircraft_document_events,
  );
  const event = after.aircraft_document_events.find((row) => !priorIds.has(row.id));
  assert.ok(event.id && event.occurred_at);
  const name =
    test.action === 'stage'
      ? 'file_staged'
      : test.action === 'download'
        ? 'download_issued'
        : state === 'clean'
          ? 'file_clean'
          : 'file_rejected';
  assert.deepEqual(event, {
    id: event.id,
    occurred_at: event.occurred_at,
    organization_id: ids.org,
    actor_user_id: ids.actor,
    target_type: 'file',
    target_id: ids.file,
    event_name: `aircraft_document.${name}`,
    outcome: test.action === 'complete' && state !== 'clean' ? 'failed' : 'success',
    reason_code: test.action === 'complete' ? state : name,
    correlation_id: ids.correlation,
    idempotency_key_hash: null,
    metadata: {
      mediaType: 'application/pdf',
      sizeBytes: test.outcome === 'size-mismatch' ? 11 : 10,
      ...(test.action === 'stage' ? { hash: 'a'.repeat(64) } : {}),
      ...(test.action === 'complete' ? { hashMatched: test.outcome !== 'hash-mismatch' } : {}),
    },
  });
}

export function assertFileReplay(test, result, replay, before, after) {
  assert.deepEqual(
    replay,
    test.action === 'complete' && finalState(test) !== 'clean'
      ? { decision: 'state_conflict', correlationId: ids.correlation }
      : result,
  );
  assert.deepEqual(after, before);
}
