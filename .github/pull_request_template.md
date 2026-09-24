## Outcome

Describe the single user or developer outcome this pull request delivers.

## Linked issue

Closes #

## Integration

Follow the [integration checkpoint](../docs/FlyEye_Documentation/09_AI_DEVELOPMENT_GUIDE.md#integration-checkpoint). State existing PR dispositions; for an explicitly directed stack or parallel work, identify dependencies, base, merge order, and final target.

## Scope

- [ ] The change is bounded to one approved feature, fix, documentation task, or chore.
- [ ] The linked issue is in the FlyEye Delivery project and links to canonical requirements where applicable.
- [ ] The bounded outcome and autonomous-delivery boundary are identified.
- [ ] Unrelated working-tree changes are excluded.
- [ ] Assumptions, unresolved questions, and known limitations are documented.
- [ ] No unverified aviation rule or regulatory claim was introduced.

## Security, tenancy, and privacy

- [ ] No credential, `.env` file, production data, restricted record, or service-role key is included.
- [ ] Tests and examples use synthetic data only.
- [ ] Tenant-owned schema changes include `organization_id`, deny-by-default RLS, and positive/negative cross-organization tests, or schema is unchanged.
- [ ] Protected operations re-check membership, permission, organization, record scope, state, and audit requirements, or protected operations are unchanged.
- [ ] Browser code cannot modify authority-bearing status, approval, finalization, role, tenant, or audit fields.

## Database and migration review

- [ ] Migrations, grants, policies, views, triggers, indexes, and privileged functions were inspected, or database behavior is unchanged.
- [ ] Generated database types match the migrated schema in the recorded local or disposable CI target, or schema/types are unchanged with linked CI evidence.
- [ ] Migration and recovery limitations are documented.

## Verification

Use [QA applicability and evidence reuse](../docs/FlyEye_Documentation/11_QA_TEST_PLAN.md#verification-applicability).
Identify the changed behavior, selected groups and evidence location. A local
N/A needs a reason; CI-supplied evidence must link the run and commit. Earlier
local evidence retains its original target. Never mark pending checks passed.

| Verification group                                                                   | Result and evidence (local / CI / reused local / justified local N/A) |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Documentation, applicable formatting, diff and mandatory prepublication secret scans |                                                                       |
| Application checks and feature-specific acceptance/security scenarios                |                                                                       |
| Database, SQL/RLS, Auth/Edge/Storage runtime, cleanup, lint and type drift           |                                                                       |

- [ ] Local selection follows QA policy; all mandatory CI jobs pass on the final head, including frozen installation, application quality, database/security verification and the aggregate gate.
- [ ] Database/runtime evidence identifies a verified disposable target; no occupied stack was reset or interrupted. Follow [database safety](../docs/FlyEye_Documentation/10_DEVSECOPS_GUIDE.md#local-setup-and-database-safety).
- [ ] React components keep reusable or authoritative business rules in typed feature modules or protected server commands, or presentation behavior is unchanged.
- [ ] Loading, error, empty, unauthorized, conflict, and success states were considered where applicable.
- [ ] Reused local evidence has a reviewed input comparison; affected checks were rerun and required CI was not substituted.

## Merge and release gates

- [ ] Relevant documentation and traceability are updated in their canonical homes without duplicated history or guardrails.
- [ ] Security, privacy, tenancy, and aviation limitations are identified for reviewers.
- [ ] All blocking separate-agent findings and hard stops were resolved and reverified; otherwise this PR remains draft/blocked and is not ready to merge.
- [ ] This pull request is ready for the human merge decision.
- [ ] No deployment is included unless separately and explicitly authorized.
- [ ] Production approval remains a separate human decision.
