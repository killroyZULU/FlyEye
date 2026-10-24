import assert from 'node:assert/strict';
import {
  ids,
  tables,
  committedPeer,
  success,
  reason,
  actualAction,
} from './h002-document-implicit-fixture.mjs';
import { expectedDomain, sameRows, uuid, timestamp } from './h002-document-implicit-domain.mjs';
import { expectedNotifications } from './h002-document-implicit-notifications.mjs';

export function assertDocument(test, result, before, after, peerState, denied) {
  if (denied || committedPeer(test)) {
    // Check rollback independently of the response classification so a conflict
    // defect cannot hide surviving domain, audit or idempotency effects.
    let evidence = 'rollback';
    try {
      assert.deepEqual(
        after,
        committedPeer(test) ? peerState : before,
        'Denied/conflicting writes must roll back',
      );
      evidence = 'response-after-verified-rollback';
      assert.deepEqual(result, {
        decision: denied ? 'unauthorized' : 'state_conflict',
        correlationId: ids.correlation,
      });
    } catch (error) {
      error.evidence = evidence;
      throw error;
    }
    return;
  }
  const model = expectedDomain(test, before, after, result);
  const { category, document, version, priorVersion, requirement, expected, response } = model;
  const decision = success(test);
  assert.deepEqual(result, {
    decision,
    ...response,
    replayed: false,
    correlationId: ids.correlation,
  });
  const notificationEvents = expectedNotifications(test, before, after, model);
  const priorDocument = before.aircraft_documents.find((row) => row.id === ids.document);
  const primary =
    test.family === 'document'
      ? {
          target_type: 'document',
          target_id: document.id,
          metadata: {
            priorAggregateVersion: priorDocument?.version ?? null,
            newAggregateVersion: document.version,
            priorDocumentState: priorDocument?.document_state ?? null,
            newDocumentState: document.document_state,
            priorDocumentVersionId: priorVersion?.id ?? null,
            newDocumentVersionId: version.id,
            priorDocumentVersion: priorVersion?.version_number ?? null,
            newDocumentVersion: version.version_number,
            categoryCode: category.category_code,
            expirationBefore: priorVersion?.expiration_date ?? null,
            expirationAfter: version.expiration_date,
            reason: test.action === 'create' ? null : reason,
            attachmentBeforePresent: Boolean(priorVersion?.stored_file_id),
            attachmentAfterPresent: Boolean(version.stored_file_id),
            attachmentHashChanged:
              Boolean(priorVersion?.stored_file_id) !== Boolean(version.stored_file_id),
          },
        }
      : {
          target_type: requirement ? 'requirement' : 'category',
          target_id: requirement?.id ?? category.id,
          metadata: {
            categoryId: category.id,
            aircraftId: requirement ? ids.aircraft : null,
            categoryVersion: category.version,
            requirementVersion: requirement?.version ?? null,
          },
        };
  const events = [
    ...notificationEvents,
    {
      ...primary,
      event_name: `aircraft_document.${decision}`,
      reason_code: decision,
      idempotency_key_hash: 'a'.repeat(64),
    },
  ];
  const priorIds = new Set(before.aircraft_document_events.map((row) => row.id));
  const added = after.aircraft_document_events.filter((row) => !priorIds.has(row.id));
  assert.equal(added.length, events.length);
  for (const event of events) {
    const actual = added.find(
      (row) => row.target_id === event.target_id && row.event_name === event.event_name,
    );
    assert.ok(actual);
    uuid(actual.id);
    timestamp(actual.occurred_at);
    expected.aircraft_document_events.push({
      id: actual.id,
      occurred_at: actual.occurred_at,
      organization_id: ids.org,
      actor_user_id: ids.actor,
      outcome: 'success',
      correlation_id: ids.correlation,
      ...event,
    });
  }
  const idem = after.aircraft_document_idempotency.find(
    (row) => row.idempotency_key_hash === 'a'.repeat(64),
  );
  assert.ok(idem);
  timestamp(idem.created_at);
  expected.aircraft_document_idempotency.push({
    organization_id: ids.org,
    actor_user_id: ids.actor,
    idempotency_key_hash: 'a'.repeat(64),
    action: actualAction(test),
    target_id: test.family === 'document' ? document.id : category.id,
    expected_version: ['create', 'create_category'].includes(test.action) ? null : 1,
    request_hash: 'b'.repeat(64),
    result: { decision, ...response, replayed: false },
    created_at: idem.created_at,
  });
  for (const table of tables) sameRows(after[table], expected[table]);
}

export function assertReplay(result, replay, before, after) {
  assert.deepEqual(replay, { ...result, replayed: true });
  assert.deepEqual(after, before);
}
