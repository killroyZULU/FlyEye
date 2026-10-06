import assert from 'node:assert/strict';
import { ids, q, scope } from './h002-review-fixture.mjs';

// Success controls prove the requested effect, not merely that some row changed.
export async function assertReviewSuccess(observer, test) {
  let event;
  if (test.name.startsWith('document-')) {
    const action = test.name.split('-')[1];
    const result = JSON.parse(
      await observer.query(`select jsonb_build_array(
      (select version from public.aircraft_documents where ${scope}),
      (select document_state from public.aircraft_documents where ${scope}),
      (select count(*) from public.aircraft_document_versions where ${scope}),
      (select count(*) from public.aircraft_document_idempotency where ${scope}));`),
    );
    assert.deepEqual(result, [
      action === 'create' ? 1 : 2,
      action === 'suspend' ? 'suspended' : 'active',
      ['renew', 'correct'].includes(action) ? 2 : 1,
      1,
    ]);
    event = `aircraft_document.${test.success}`;
  } else if (test.name.includes('_category-')) {
    const action = test.name.split('-')[0];
    assert.equal(
      await observer.query(
        `select count(*) from public.aircraft_document_idempotency where ${scope};`,
      ),
      '1',
    );
    if (action === 'create_category') {
      assert.equal(
        await observer.query(`select count(*) from public.aircraft_document_categories
        where ${scope} and category_kind='custom' and category_label='Synthetic changed' and version=1;`),
        '1',
      );
    } else if (['rename_category', 'archive_category'].includes(action)) {
      assert.equal(
        await observer.query(
          `select version from public.aircraft_document_categories where id=${q('category')};`,
        ),
        '2',
      );
      assert.equal(
        await observer.query(`select ${action === 'rename_category' ? 'category_label' : 'category_state'}
        from public.aircraft_document_categories where id=${q('category')};`),
        action === 'rename_category' ? 'Synthetic changed' : 'archived',
      );
    } else {
      assert.equal(
        await observer.query(
          `select version || ':' || requirement_state from public.aircraft_document_requirements where ${scope};`,
        ),
        `2:${action === 'assign_category' ? 'active' : 'archived'}`,
      );
    }
    event = `aircraft_document.${test.success}`;
  } else if (test.name === 'file-complete') {
    assert.equal(
      await observer.query(
        `select scan_state || ':' || size_bytes from public.stored_files where id=${q('file')};`,
      ),
      'clean:10',
    );
    event = 'aircraft_document.file_clean';
  } else if (test.name === 'notification-open') {
    assert.equal(
      await observer.query(
        `select notification_state from public.aircraft_document_notifications where id=${q('notification')};`,
      ),
      'read',
    );
    event = 'aircraft_document.notification_opened';
  } else if (test.name === 'profile-update') {
    assert.equal(
      await observer.query(`select display_name || ':' || version from public.organization_member_profiles
      where membership_id=${q('member')};`),
      'Synthetic updated:2',
    );
    event = 'member_profile.updated';
  }
  if (event) {
    assert.equal(
      await observer.query(`select count(*) from public.${test.eventTable}
      where actor_user_id='${ids.actor}' and event_name='${event}' and outcome='success';`),
      '1',
    );
  }
}
