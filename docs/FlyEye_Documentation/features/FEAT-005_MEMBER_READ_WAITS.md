# Feature Specification: FEAT-005 — Audited Member/Profile Read Waits

Split from the near-budget [feature contract](FEAT-005_USER_MANAGEMENT_AND_BASIC_PROFILES.md).

R5 [#202](https://github.com/killroyZULU/FlyEye/issues/202) investigates only
`list_organization_members`, `get_organization_member` and `get_my_member_profile`
against baseline `bb45091bc7f70922a62623716d7ef63977e2e375`.
[Traceability](FEAT-007_REGISTRY_IMPLICIT_WAIT_TRACEABILITY.md#memberprofile-read-investigation)
records execution separately from this prospective contract.

| Read             | Natural audit barriers                               | Authority variants                                              | Schedules |
| ---------------- | ---------------------------------------------------- | --------------------------------------------------------------- | --------: |
| Directory list   | Audit relation SHARE; organization and actor-user FK | Membership revocation, role demotion, retained administrator    |         9 |
| Directory detail | Those three plus target-membership FK                | Membership revocation, role demotion, retained administrator    |        12 |
| Own profile      | Those four, using actor membership as target         | Membership revocation, retained administrator, retained student |        12 |

Freeze 33 schedules: 18 denials and 15 controls. Detail targets another member;
actor-user means the reader. The blocker performs the protected revocation after
observing the worker wait, captures its precommit state, then commits and releases
the barrier. Independently verify committed membership/role/audit state afterwards.
Require the exact blocker relationship and ungranted audit `RowExclusiveLock`;
unexpected serialization, timeout or observer failure does not satisfy a denial.

Prior revocation requires only `not_found` and correlation ID, with no response
data or worker access audit and no change to the protected revocation snapshot.
Retained controls verify all returned fields, nullable profiles, list ordering,
detail action options and exactly one minimized event. Explicit successful read
retries create another event; denied retries add none. Student own-profile access
remains valid. Reuse existing pagination/validation evidence; add service-only
signature, School A/B, foreign-target, ownership and mandatory `P5005` regressions.

Use unchanged-production characterization before any correction. Preserve
quiescence, session absence, interrupted cleanup, zero residue and unchanged
permissions under [database safety](../10_DEVSECOPS_GUIDE.md#local-setup-and-database-safety).
Other reads, global permissions, provider/session policy and hosted behavior are
outside this manifest.
