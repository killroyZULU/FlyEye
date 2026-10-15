# Feature Specification: FEAT-003 Current Factor Sessions

## Scope and requirement

This focused reference separates the session-binding contract from the parent
[onboarding specification](FEAT-003_ORGANIZATION_ADMIN_AND_MFA_ONBOARDING.md#mixed-inventories-and-unverified-replacement)
to keep its security invariants reviewable within the documentation budget.

Sole verified-factor replacement must reject the old-factor session and onboarding
attempt. Refresh or verification of the replacement in that same session is
insufficient. Continuing requires fresh password sign-in and verification with
the current factor. Preserve any committed administrator while denying stale
final bootstrap access. No user-facing replacement/recovery workflow is added.

Stale attempts mean requests using the old session and obsolete browser results.
A genuinely fresh password/current-factor session retains existing actor/grant
idempotency semantics; there is no new operation-token contract. Cancellation and
status remain governed by their existing protected contracts.

## Server binding

Record immutable factor provenance for new Auth sessions. At creation, capture the
sole verified TOTP even for a password-only AAL1 session. Ambiguous inventories
remain unknown. For a known session initially without a verified factor, capture
the first provider verification or sole verified factor seen at START. Compare
and set under a binding-row lock; never overwrite or clear the factor on refresh,
unenrollment, reassociation or deletion of that factor.

The identity-owned binding is server-only security metadata, not tenant content.
Use deny-by-default RLS, no browser table/function grants, restricted definer
search paths and a service-only validator. The trigger writes only this metadata;
it cannot change provider credentials, sessions or permissions. Its transaction
must roll back on failure. Session/user deletion cascades owned binding cleanup.

Historical or missing provenance is unknown, including a pre-existing non-null
provider factor identifier. Never infer original identity from timestamps or
backfill the current factor. Refresh, validation and later verification cannot
make unknown history trusted. Affected pre-migration sessions require fresh
password sign-in; this is a rollout compatibility requirement, not a global
session-revocation policy.

Before START/COMPLETE and granted-administrator bootstrap, validate ownership,
known immutable provenance and the complete current inventory. COMPLETE/bootstrap
also require the provider session's current factor, AAL2 and password/TOTP AMR.
Keep verified-token AAL/AMR checks independent: database AAL2 cannot upgrade an
older AAL1 token. Preserve existing password freshness, limiter and mandatory
denial-audit behavior. Unknown provider/database results fail closed without an
automatic retry. An invalid onboarding binding requires fresh sign-in; bootstrap
retains the safe authenticator-conflict response.

The validator locks only its child binding, never an Auth parent after that lock.
Its transaction ends before the existing organization/grant locks. Preserve the
parent specification's Auth/database consistency boundary: replacement after the
pre-RPC check can coexist with an exact committed completion, but final stale
bootstrap must deny. Do not revoke or remove an already-committed administrator.

## Frozen verification matrix

Use owned synthetic identities in the pinned disposable provider:

1. Old-factor COMPLETE after sole verified replacement.
2. Old-factor START after replacement.
3. Refresh of the old session.
4. Re-challenge with the replacement in that same session.
5. AAL1 START under the original factor, then replacement verification.
6. Password sign-in under the original factor before replacement, without START.
7. Completed same-key replay with the stale session and permitted fresh-session replay.
8. Replacement during an observed organization completion wait.
9. Replacement during an observed grant completion wait.
10. Concurrent binding and provider reassociation.
11. Delayed real browser verification response after replacement.

Pair negative cases with fresh-password/current-factor recovery. Compare exact
grant, membership/profile/role, session/factor and attributable audit state; retain
foreign state and permission definitions. Interrupt a separate grant-wait run,
settle owned work and prove domain/Auth/binding/limiter cleanup. Quota, outage or
timeout is not evidence of factor denial.

Scoped SQL/handler checks cover unknown/missing history, wrong subject/session,
immutable binding, ordinary enrollment/challenge/unenroll/refresh, token versus
database assurance, audit failure, pruning/deletion cascades, transaction rollback,
concurrent deletion and lock ordering. Reuse the existing cross-school, cancellation
and provider-uncertainty suites. Source assertions and mocked handler failures do
not establish provider runtime results.

## Delivery risks and acceptance

The Auth trigger introduces a provider-schema compatibility obligation. Verify the
pinned provider's login, verification, refresh and cleanup transactions; a future
provider upgrade must rerun these checks. No hosted application of the migration
is authorized by local verification. Roll forward a reviewed correction if needed;
never recover by disabling the gate or trusting unknown sessions.

Acceptance requires the matrix and compatibility checks, separate review, exact
final-head required CI, and owned cleanup. Record results in
[traceability](FEAT-003_TRACEABILITY.md); a documented plan is not closure. Hosted
session policy, recovery, privacy, qualified workflow and production gates remain
in their existing canonical records.
