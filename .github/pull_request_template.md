## Outcome

Describe the single user or developer outcome this pull request delivers.

## Scope

- [ ] The change is bounded to one approved feature, fix, documentation task, or chore.
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
- [ ] Formatting, ESLint, TypeScript, unit/component/handler tests, and production build pass.
- [ ] Browser-specific Supabase and general repository secret scans pass.
- [ ] Playwright tests pass.
- [ ] Local Supabase reset, schema-wide SQL/RLS tests, real Auth/TOTP/Edge/cross-organization integration, and database lint pass.
- [ ] Dependency audit passes without an unresolved high or critical advisory.
- [ ] Loading, error, empty, unauthorized, conflict, and success states were considered where applicable.

## Human gates

- [ ] Relevant documentation and traceability are updated.
- [ ] Security, privacy, tenancy, and aviation limitations are identified for reviewers.
- [ ] No deployment is included unless separately and explicitly authorized.
- [ ] Production approval remains a separate human decision.
