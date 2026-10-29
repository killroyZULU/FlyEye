## Outcome and scope

Closes #

State the outcome, acceptance criteria, exclusions and stopping conditions.
Link the canonical contract and Delivery project issue. For a bounded correction,
describe the relevant delta rather than repeating feature discovery/design.
Identify the completion boundary and weighted milestones under the
[delivery policy](../docs/FlyEye_Documentation/09_AI_DEVELOPMENT_GUIDE.md#planning-and-tracking).

## Integration

Record base/head, dependencies, overlapping ownership and existing PR dispositions
under the [integration checkpoint](../docs/FlyEye_Documentation/09_AI_DEVELOPMENT_GUIDE.md#integration-checkpoint).
For an explicitly directed stack/parallel task, include parent/base, merge order
and final target. Record actual protection compatibility; do not change settings.

## Verification and review

Use [QA applicability, tiers and reuse](../docs/FlyEye_Documentation/11_QA_TEST_PLAN.md#verification-applicability).
Record CI route/reason and exact final-head run. Governance/CI changes require full
verification. A skipped group is not a pass; pending evidence remains pending.

| Group                                                            | Result, target/environment and evidence |
| ---------------------------------------------------------------- | --------------------------------------- |
| Documentation, formatting, diff and prepublication secret scans  |                                         |
| Application and feature acceptance/security checks               |                                         |
| Database/runtime, concurrency, cleanup, lint and generated types |                                         |
| Independent review, findings and affected reverification         |                                         |

For local reuse, link the original result and reviewed input comparison. Explain
local exclusions and CI-supplied evidence. Confirm affected authority, tenancy,
privacy, audit, migration/grant and UI-state coverage against canonical requirements;
identify unchanged surfaces without copying their checklists. Preserve occupied
environments under [database safety](../docs/FlyEye_Documentation/10_DEVSECOPS_GUIDE.md#local-setup-and-database-safety).

## Handoff

Report branch/head, push and working-tree state, limitations and the next owner
decision. Blocking findings, failed required checks or unresolved hard stops
prevent review-ready completion. Keep merge, real-data acceptance and release
separate under [AGENTS.md](../AGENTS.md#hard-stops). Policy changes require the
[post-integration adoption receipt](../docs/FlyEye_Documentation/09_AI_DEVELOPMENT_GUIDE.md#policy-adoption);
reading policy does not update another branch's workflow or permissions.
