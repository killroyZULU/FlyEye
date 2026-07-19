# Data API and Protected Function Specification

## 1. Purpose

FlyEye does not begin with a separately hosted custom REST API. It uses:

1. the Supabase-generated Data API for explicitly approved low-risk reads and editable drafts under Row-Level Security;
2. Supabase Edge Functions for protected application commands and external integrations; and
3. reviewed PostgreSQL functions/RPCs for atomic relational changes and domain invariants where appropriate.

Individual feature specifications define the final contract for each operation.

## 2. Core rules

- The browser uses only the publishable Supabase key and the authenticated user session.
- The service-role key is restricted to controlled server-side functions and CI/operations that require it.
- Client-provided `organization_id`, role, or permission data is never accepted as authority.
- Every direct table operation is protected by tested RLS.
- Every protected command revalidates user, membership, permission, tenant, record scope, state, concurrency, and required reason.
- Status, finalization, approval, role, and audit-sensitive fields are not directly writable by normal client roles.
- All timestamps are UTC and public identifiers are opaque UUIDs.
- Errors use stable machine-readable codes and safe user messages.

## 3. Approved direct Data API use

Candidate direct operations after RLS tests:

- read the authenticated user’s visible organizations and assigned records;
- read organization-scoped reference data permitted to the role;
- create and update an editable dispatch or assessment draft owned/assigned to the user;
- read allowed progress, document metadata, notifications, and audit summaries;
- insert a narrowly scoped upload request record before protected validation.

Direct access is a privilege granted per table/action, not the default architecture.

## 4. Protected command catalog

| Domain | Candidate Edge Function / RPC |
|---|---|
| Membership | `invite-member`, `revoke-invitation`, `change-member-roles`, `suspend-member` |
| Dispatch | `submit-dispatch`, `start-dispatch-review`, `return-dispatch`, `approve-dispatch`, `reject-dispatch`, `cancel-dispatch`, `complete-dispatch`, `reopen-dispatch` |
| Weight and balance | `calculate-weight-balance`, `finalize-weight-balance-snapshot` |
| Assessment | `finalize-assessment`, `reopen-assessment`, `acknowledge-assessment` |
| Documents | `create-upload-session`, `complete-upload`, `authorize-download`, `generate-dispatch-pdf` |
| Reports | `request-export`, `get-export-status`, `authorize-export-download` |
| Integrations | `retrieve-weather`, `retrieve-notams`, `send-notification` |
| AI | `structure-instructor-comment`, later narrowly scoped assistants |

Names may change during feature specification; their authority boundaries may not be weakened casually.

## 5. Protected command sequence

```text
Receive request
  -> verify JWT
  -> load active membership from PostgreSQL
  -> check MFA/permission and target organization
  -> load record and validate assignment/current state/version
  -> validate request and authoritative domain rules
  -> execute atomic database function/transaction
  -> create audit event in the same transaction
  -> enqueue or perform bounded notification/integration work
  -> return safe result and correlation ID
```

External side effects should be idempotent and must not create a business state that lacks corresponding audit evidence.

## 6. Example: return dispatch

```http
POST /functions/v1/return-dispatch
Authorization: Bearer <user-session-token>
Idempotency-Key: <opaque-value>
Content-Type: application/json

{
  "dispatchRecordId": "uuid",
  "expectedVersion": 4,
  "reason": "The loading entry is incomplete."
}
```

```json
{
  "data": {
    "id": "uuid",
    "status": "returned_for_correction",
    "revision": 2,
    "version": 5,
    "returnedAt": "2027-01-15T03:20:00Z"
  },
  "correlationId": "opaque-id"
}
```

The function must not trust an organization ID from the request. It derives the record’s organization, checks active membership and `dispatch.review`, validates assignment and state, applies optimistic concurrency, requires a bounded reason, creates a preserved revision, and emits the audit event atomically.

## 7. Error contract

```json
{
  "error": {
    "code": "dispatch.validation_failed",
    "message": "Review the highlighted information.",
    "fieldErrors": {
      "plannedDeparture": ["A planned departure is required."]
    }
  },
  "correlationId": "opaque-id"
}
```

Use `401` for unauthenticated, `403` for unauthorized without revealing hidden data, `404` when safe to avoid resource enumeration, `409` for state/concurrency conflict, `422` for business validation, and `429` for rate limits. Never return stack traces, SQL, secrets, tenant existence, or sensitive authorization reasoning.

## 8. Database functions

Use PostgreSQL functions when the operation benefits from atomic multi-table changes and database-enforced invariants. Security-definer functions require exceptional review: fixed `search_path`, minimal grants, no dynamic unsafe SQL, explicit user/tenant validation, no arbitrary table/column input, and direct SQL/RLS tests.

## 9. File flow

1. Authenticated user requests a staged upload.
2. Server validates purpose, record scope, type, and size.
3. Upload goes to a private temporary path.
4. Protected completion validates signature/hash and obtains malware-scan result.
5. Only a clean file is attached to the record and audited.
6. Downloads use RLS or a short-lived signed URL issued after authorization.

Public buckets are prohibited for restricted records.

## 10. Type safety and schema changes

Generate TypeScript database types from the versioned Supabase schema. Domain command request/response schemas are defined in shared TypeScript modules and validated at runtime. CI detects type/schema drift. A database type generator does not replace feature-level validation or stable error contracts.

## 11. Rate limiting and abuse controls

Apply stricter limits to authentication recovery, invitations, protected transitions, downloads, exports, document generation, external-provider retrieval, and AI requests. Limits should consider user, organization, IP, cost, and operation sensitivity.

## 12. External providers

Email, weather/NOTAM, malware scanning, storage automation, and AI are called only from protected functions. Preserve provider/source ID, retrieval time, freshness, failure status, and applicable license/terms. Core workflows specify safe behavior when a provider is unavailable.

## 13. Future dedicated API

Introduce a dedicated API only when measured complexity or operational needs justify it. If that happens, preserve current command contracts and migrate one bounded domain at a time instead of rewriting the whole application.
