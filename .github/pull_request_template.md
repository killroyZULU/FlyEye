## Outcome

Describe the single user or developer outcome this pull request delivers.

## Linked issue

Closes #

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
- [ ] Generated database types match the local migrated schema.
- [ ] Migration and recovery limitations are documented.

## Verification

- [ ] Frozen dependency installation passes.
- [ ] Formatting, documentation architecture, ESLint, TypeScript, unit/component/handler tests, and production build pass.
- [ ] Code-maintainability architecture checks and configured coverage floors pass.
- [ ] React components keep reusable or authoritative business rules in typed feature modules or protected server commands, or presentation behavior is unchanged.
- [ ] Browser-specific Supabase and general repository secret scans pass.
- [ ] Playwright tests pass.
- [ ] Local Supabase reset, schema-wide SQL/RLS tests, real Auth/TOTP/Edge/cross-organization integration, and database lint pass.
- [ ] Dependency audit passes without an unresolved high or critical advisory.
- [ ] Loading, error, empty, unauthorized, conflict, and success states were considered where applicable.
- [ ] Focused correction checks and one final matrix were used; unchanged evidence was not rerun without a fingerprint change.

## Merge and release gates

- [ ] Relevant documentation and traceability are updated in their canonical homes without duplicated history or guardrails.
- [ ] Security, privacy, tenancy, and aviation limitations are identified for reviewers.
- [ ] All blocking separate-agent findings and hard stops were resolved and reverified; otherwise this PR remains draft/blocked and is not ready to merge.
- [ ] This pull request is ready for the human merge decision.
- [ ] No deployment is included unless separately and explicitly authorized.
- [ ] Production approval remains a separate human decision.
