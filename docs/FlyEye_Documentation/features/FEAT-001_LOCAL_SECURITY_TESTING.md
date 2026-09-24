# FEAT-001 local security testing

This procedure is for the synthetic local Supabase stack only. It does not configure staging or production.

## Safety boundary

Use [DevSecOps setup and database safety](../10_DEVSECOPS_GUIDE.md#local-setup-and-database-safety)
for tool installation, target/disposability checks, credential handling and
service lifecycle. Use synthetic `example.test` users only. This feature guide
does not authorize resetting or interrupting an occupied stack.

## Local Auth and TOTP settings

`supabase/config.toml` intentionally uses these separate controls:

- `[auth] enable_signup = false` blocks public account creation.
- `[auth.email] enable_signup = true` enables email/password authentication for existing users created through the local admin test path. With the email provider disabled, existing users cannot sign in.
- `[auth.mfa.totp] enroll_enabled = true` and `verify_enabled = true` permit local TOTP enrollment, challenge, and verification.
- `[functions.auth-bootstrap] verify_jwt = true` makes JWT verification explicit.

Apply Auth or function environment changes by restarting only the task-owned
disposable stack under the linked safety procedure.

## Allowed origin

The checked-in Edge environment example uses `http://127.0.0.1:5173`.
`auth-bootstrap` fails closed when `ALLOWED_ORIGIN` is absent. Configure the
ignored local file through the shared setup procedure without overwriting an
existing file. Later authorized hosted environments require their exact deployed
origin through the Edge Function secret mechanism; never use `*`.

## Verification

Select the matrix using [QA applicability](../11_QA_TEST_PLAN.md#verification-applicability).
The protected-behavior row applies when changing this authentication boundary.
Execute against an authorized disposable local target or use disposable CI when
the local stack is occupied. The shared DevSecOps procedure owns full-group
commands and the non-mutating generated-type check.

`test:edge-runtime` refuses non-loopback Supabase URLs. It creates ephemeral synthetic users and one synthetic school, tests public-signup/anonymous/invalid-JWT denial, real password/TOTP/AAL flows, suspended/revoked membership denial, forged school selection, ambiguous context, direct RPC/table denial, body limits, audit cardinality, and real browser Student/Instructor flows, then removes its test data.

The local integration harness is automated evidence, not an independent penetration test or production-readiness approval.
