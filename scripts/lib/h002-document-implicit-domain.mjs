import assert from 'node:assert/strict';
import { ids, reason, label, expiration } from './h002-document-implicit-fixture.mjs';

export const uuid = (value) =>
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const timestamp = (value) =>
  assert.ok(typeof value === 'string' && Number.isFinite(Date.parse(value)));
export const rows = (value) =>
  [...value].sort((a, b) =>
    String(a.id ?? a.idempotency_key_hash).localeCompare(String(b.id ?? b.idempotency_key_hash)),
  );
export function sameRows(actual, expected) {
  assert.deepEqual(rows(actual), rows(expected));
}
const find = (state, table, id) => state[table].find((row) => row.id === id);
const categoryTable = 'aircraft_document_categories';
const documentTable = 'aircraft_documents';
const versionTable = 'aircraft_document_versions';
const requirementTable = 'aircraft_document_requirements';
function created(actual) {
  assert.ok(actual);
  uuid(actual.id);
  timestamp(actual.created_at);
  timestamp(actual.updated_at);
  assert.equal(actual.created_at, actual.updated_at);
  return {
    id: actual.id,
    organization_id: ids.org,
    created_at: actual.created_at,
    updated_at: actual.updated_at,
    created_by: ids.actor,
    updated_by: ids.actor,
    version: 1,
    archived_at: null,
    archived_by: null,
  };
}
function update(expected, actual) {
  assert.ok(actual);
  timestamp(actual.updated_at);
  expected.version++;
  expected.updated_by = ids.actor;
  expected.updated_at = actual.updated_at;
}
function archive(expected, actual, field) {
  update(expected, actual);
  timestamp(actual.archived_at);
  assert.equal(actual.archived_at, actual.updated_at);
  Object.assign(expected, {
    [field]: 'archived',
    archived_at: actual.archived_at,
    archived_by: ids.actor,
  });
}

// Build expected domain records from the fixture and contract; only generated IDs/times
// come from actual output, and those are separately validated. No changed row is omitted.
export function expectedDomain(test, before, after, result) {
  const expected = structuredClone(before);
  let category = find(expected, categoryTable, ids.category);
  let document = find(expected, documentTable, ids.document);
  const priorVersion = find(before, versionTable, ids.version);
  let version = priorVersion;
  let requirement = expected[requirementTable].find((row) => row.category_id === ids.category);
  if (test.family === 'document') {
    const actual = find(after, documentTable, result.documentId);
    if (test.action === 'create') {
      document = {
        ...created(actual),
        aircraft_record_id: ids.aircraft,
        category_id: ids.category,
        document_state: 'active',
        current_version_id: result.currentVersionId,
        suspension_reason: null,
        suspended_at: null,
        suspended_by: null,
      };
      expected[documentTable].push(document);
    } else {
      assert.equal(result.documentId, ids.document);
      update(document, actual);
    }
    if (['create', 'renew', 'correct'].includes(test.action)) {
      const actualVersion = find(after, versionTable, result.currentVersionId);
      assert.ok(actualVersion);
      uuid(actualVersion.id);
      timestamp(actualVersion.created_at);
      version = {
        id: actualVersion.id,
        organization_id: ids.org,
        aircraft_document_id: document.id,
        version_number: test.action === 'create' ? 1 : 2,
        version_kind: { create: 'create', renew: 'renewal', correct: 'correction' }[test.action],
        category_code: 'custom_h002',
        category_label: 'Synthetic review',
        document_title: 'Synthetic next document',
        document_source: 'Synthetic next source',
        reference_number: 'SYN-REF',
        issue_date: '2026-09-01',
        expiration_date: expiration(test),
        notes: 'Synthetic note',
        stored_file_id: ids.file,
        version_reason: test.action === 'create' ? null : reason,
        created_at: actualVersion.created_at,
        created_by: ids.actor,
      };
      assert.equal(actualVersion.created_at, actual.updated_at);
      expected[versionTable].push(version);
      document.current_version_id = version.id;
    } else if (test.action === 'suspend') {
      timestamp(actual.suspended_at);
      assert.equal(actual.suspended_at, actual.updated_at);
      Object.assign(document, {
        document_state: 'suspended',
        suspension_reason: reason,
        suspended_at: actual.suspended_at,
        suspended_by: ids.actor,
      });
    } else
      Object.assign(document, {
        document_state: 'active',
        suspension_reason: null,
        suspended_at: null,
        suspended_by: null,
      });
  } else {
    const actualCategory = find(after, categoryTable, result.categoryId);
    if (test.action === 'create_category') {
      assert.match(result.categoryCode, /^custom_[0-9a-f]{32}$/);
      category = {
        ...created(actualCategory),
        category_code: result.categoryCode,
        category_label: label,
        category_kind: 'custom',
        category_state: 'active',
      };
      expected[categoryTable].push(category);
    } else {
      assert.equal(result.categoryId, ids.category);
      if (test.action === 'rename_category') {
        update(category, actualCategory);
        category.category_label = label;
      }
      if (test.action === 'archive_category') archive(category, actualCategory, 'category_state');
    }
    const actualRequirement = after[requirementTable].find(
      (row) => row.category_id === ids.category,
    );
    if (test.action === 'assign_new') {
      requirement = {
        ...created(actualRequirement),
        aircraft_record_id: ids.aircraft,
        category_id: ids.category,
        requirement_state: 'active',
      };
      expected[requirementTable].push(requirement);
    } else if (test.action === 'reassign') {
      update(requirement, actualRequirement);
      Object.assign(requirement, {
        requirement_state: 'active',
        archived_at: null,
        archived_by: null,
      });
      update(document, find(after, documentTable, ids.document));
      Object.assign(document, {
        document_state: 'active',
        archived_at: null,
        archived_by: null,
        suspension_reason: null,
        suspended_at: null,
        suspended_by: null,
      });
    } else if (['archive_category', 'remove_category'].includes(test.action)) {
      archive(requirement, actualRequirement, 'requirement_state');
      archive(document, find(after, documentTable, ids.document), 'document_state');
    }
  }
  const usesRequirement = ['assign_new', 'reassign', 'remove_category'].includes(test.action);
  const response =
    test.family === 'document'
      ? {
          documentId: document.id,
          aggregateVersion: document.version,
          documentState: document.document_state,
          currentVersionId: version.id,
          currentVersionNumber: version.version_number,
        }
      : {
          categoryId: category.id,
          categoryCode: category.category_code,
          categoryLabel: category.category_label,
          categoryState: category.category_state,
          categoryVersion: category.version,
          requirementId: usesRequirement ? requirement.id : null,
          requirementVersion: usesRequirement ? requirement.version : null,
        };
  return {
    expected,
    category,
    document,
    version,
    priorVersion,
    requirement: usesRequirement ? requirement : null,
    response,
  };
}
