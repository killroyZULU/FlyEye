# FEAT-007 Traceability

This focused record separates limiter execution evidence from
[FEAT-007 traceability](FEAT-007_TRACEABILITY.md#limiter-evidence) to preserve its
size budget. Contracts remain in the respective feature specifications.

## Registry limiter

At `64bf764`, [baseline CI](https://github.com/killroyZULU/FlyEye/actions/runs/38018796307)
reproduced `general-older-waiter` timestamp rewind; 21 cases were unreached.
Normal and interrupted cleanup passed. [PR #139](https://github.com/killroyZULU/FlyEye/pull/139)
records the [runner](../../../scripts/test-aircraft-registry-limiter.mjs), narrow
correction and separate review. At merge `31c2ad3`,
[post-merge CI](https://github.com/killroyZULU/FlyEye/actions/runs/38021190117)
passed all 22 selected cases, zero owned residue/unchanged permissions, 472 SQL/RLS
assertions, nine runtime fixtures and cleanup, database lint/types and teardown.

## Document limiter

The [runner](../../../scripts/test-aircraft-document-limiter.mjs) implements the
[SEC-014 matrix](FEAT-007_AIRCRAFT_DOCUMENT_RECORDS.md#limiter-concurrency-investigation).
Its execution results are not yet established. Source inspection identifies a
pre-lock timestamp candidate; it is not reproduction evidence.
