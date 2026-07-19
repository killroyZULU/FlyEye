# FEAT-001 local security testing

This procedure is for the synthetic local Supabase stack only. It does not configure staging or production.

## Safety boundary

The Supabase CLI reports that local services bind to `0.0.0.0`, use shared development credentials, and include network-accessible development services. Never place production credentials, production records, real restricted documents, or unrestricted real personal data in this stack. Use synthetic `example.test` users only, and stop the stack when it is not being tested.

The values printed by `supabase start` are development credentials, not secrets suitable for any deployed environment. Do not copy them into source, screenshots, documentation, prompts, staging, or production.

## Local Auth and TOTP settings

`supabase/config.toml` intentionally uses these separate controls:

- `[auth] enable_signup = false` blocks public account creation.
- `[auth.email] enable_signup = true` enables email/password authentication for existing users created through the local admin test path. With the email provider disabled, existing users cannot sign in.
- `[auth.mfa.totp] enroll_enabled = true` and `verify_enabled = true` permit local TOTP enrollment, challenge, and verification.
- `[functions.auth-bootstrap] verify_jwt = true` makes JWT verification explicit.

Restart the local stack after changing Auth or function environment configuration.

## Allowed origin

Copy `supabase/functions/.env.example` to the git-ignored `supabase/functions/.env` and keep only the exact local frontend origin:

```powershell
Copy-Item supabase/functions/.env.example supabase/functions/.env
```

The repository's local file uses `http://127.0.0.1:5173`. `auth-bootstrap` fails closed when `ALLOWED_ORIGIN` is absent. For staging or production, set the exact deployed frontend origin through the Supabase Edge Function secret mechanism; do not commit it as a production value and do not use `*`.

## Verification

From the repository root:

```powershell
pnpm db:start
pnpm test:sql
pnpm test:edge-runtime
pnpm db:types
```

`test:edge-runtime` refuses non-loopback Supabase URLs. It creates ephemeral synthetic users and two synthetic organizations, tests public-signup/anonymous/invalid-JWT denial, real password/TOTP/AAL flows, suspended/revoked membership denial, tenant isolation, organization selection, direct RPC/table denial, body limits, audit cardinality, and real browser Student/Instructor flows, then removes its test data.

The local integration harness is automated evidence, not an independent penetration test or production-readiness approval.
