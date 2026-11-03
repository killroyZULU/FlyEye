# FEAT-003 Traceability

## Staging readiness evidence

This focused record separates provider readiness from the existing
[FEAT-003 evidence](FEAT-003_TRACEABILITY.md#staging-readiness-evidence), preserving
its size budget and historical controls.

Read-only observations on 2026-11-01 support the selected
[staging contract](FEAT-003_SYNTHETIC_STAGING_BASELINE.md), not hosted application
acceptance. [Issue #210](https://github.com/killroyZULU/FlyEye/issues/210) and its
linked PR own the documentation verification/review receipt. No secrets or raw
provider screenshots are required to retain this evidence.

| Evidence                     | Source and observed result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Limit                                                                                                                                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider selection           | [Governance](../17_PRODUCT_AND_GOVERNANCE_DECISIONS.md#hosting-and-environments) records owner-selected accounts, names, region and ceiling.                                                                                                                                                                                                                                                                                                                                                              | Selection does not reserve a name or authorize creation.                                                                                                                                                                                        |
| Supabase plan/capacity/quote | Connected organization/project/cost reads returned selected organization on Free, no visible projects, and new-project quote 0/month.                                                                                                                                                                                                                                                                                                                                                                     | Snapshot, not guaranteed capacity/price; repeat before creation.                                                                                                                                                                                |
| Supabase dashboard authority | [Team page](https://supabase.com/dashboard/org/pdabjpfgbewkofmcjolg/team): one member, current user Owner. [Security page](https://supabase.com/dashboard/account/security): Google Authenticator registered 16:14:39 and Microsoft registered 16:25:36, Philippine time; successful second-factor notice.                                                                                                                                                                                                | Registration independently observed; provider MFA is not FlyEye-user MFA, vault readiness or recovery execution proof.                                                                                                                          |
| Cloudflare account           | [Member permissions](https://dash.cloudflare.com/bca1f638d55dc4770f073b33397fce62/members): sole listed member, active, 2FA On, Super Administrator — All Privileges for entire account. [Subscriptions](https://dash.cloudflare.com/bca1f638d55dc4770f073b33397fce62/billing/subscriptions): Workers Free active, no paid subscription shown and no payment method. Refreshed [Workers & Pages](https://dash.cloudflare.com/bca1f638d55dc4770f073b33397fce62/workers-and-pages) accessible, no projects. | Not a name reservation, creation test, billing audit or tested recovery.                                                                                                                                                                        |
| Owner confirmations          | Owner confirmed provider readiness/recovery arrangements, then reported second Supabase factor sign-in tested and its setup secret secured on paper; no second physical authenticator device.                                                                                                                                                                                                                                                                                                             | Custody/sign-in are owner-reported. Two entries on one phone are not independent devices; offline secret is the stated recovery route. Reconstruction on a replacement device and upstream GitHub/email recovery were not independently tested. |
| Repository baseline          | `5ec1108d5bb72d12e9512b497836dc249b5a331c`, [S0 PR #209](https://github.com/killroyZULU/FlyEye/pull/209), [exact-main CI](https://github.com/killroyZULU/FlyEye/actions/runs/41275472976) completed successfully. Manifest disabled/target-free; issuer dormant; protected runtime hosted profiles rejected.                                                                                                                                                                                              | Local/CI evidence only. This contract revision adds no implementation.                                                                                                                                                                          |

The historical observations above predate the P2 receipt below.

All [STG-01–08](FEAT-003_SYNTHETIC_STAGING_BASELINE.md#first-checkpoint-acceptance)
remain **pending**: P2 resources and P3a repository identity checks do not supply
hosted issuer/no-send behavior, application account/role setup, migrations, functions,
frontend deployment, hosted smoke/redeployment or a data recovery drill.
Provider account checks do not close these gates. Historical CI above is not
this documentation PR's final-head CI; record fresh results in the linked PR.

## P1 preflight evidence

[Issue #212](https://github.com/killroyZULU/FlyEye/issues/212) and its linked PR own
the exact-target verification/review receipt. The offline
[suite](../../../scripts/lib/feat-003-staging-preflight.test.mjs),
`FEAT-003 P1 offline preflight`, uses synthetic packages, approval references and
byte bundles. P3a uses the real non-secret P2 identity record in offline tests.

| Requirement                                                                     | Automated evidence and limit                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [P1-AC01](FEAT-003_SYNTHETIC_STAGING_BASELINE.md#p1-offline-preflight-contract) | `rejects a disabled manifest before inspecting later inputs`; P3a adds the reviewed target binding below. Original disabled-default evidence remains at [P1 head](https://github.com/killroyZULU/FlyEye/blob/8727727a01f3261e65da5529043d8568284706f4/scripts/lib/feat-003-staging-preflight.test.mjs). |
| [P1-AC02](FEAT-003_SYNTHETIC_STAGING_BASELINE.md#p1-offline-preflight-contract) | Missing-field/target-identity table tests and the structurally valid other-account regression reject substitution against the separate review record.                                                                                                                                                   |
| [P1-AC03](FEAT-003_SYNTHETIC_STAGING_BASELINE.md#p1-offline-preflight-contract) | Revision/hash failure table, artifact inventory/byte tests and `invalidates approval on a byte-only package or manifest change`. Hashes do not establish safe content or provenance.                                                                                                                    |
| [P1-AC04](FEAT-003_SYNTHETIC_STAGING_BASELINE.md#p1-offline-preflight-contract) | Approval failure table rejects absent, identical, changed or unreviewed references. Reference equality is not approval authentication.                                                                                                                                                                  |
| [P1-AC05](FEAT-003_SYNTHETIC_STAGING_BASELINE.md#p1-offline-preflight-contract) | `guardedCall` blocks environment/credential and global-fetch access around positive/negative calls; `keeps the complete validator dependency graph free of IO and execution capabilities` includes the target record. Fixed errors never echo inputs; success grants no execution authority.            |

Focused checks passed locally. Full final-head CI and separate review are recorded
in the linked PR, not inferred from this evidence map. No hosted acceptance,
issuer/no-send implementation or resource creation is supplied by P1.

## P2 resource verification

Read-only provider verification on 2026-11-03 confirmed the identities now held in
the [target record](../../../config/feat-003-staging-target.mjs). Creation used
separate owner authorization, existing provider sessions and the Free/$0 quote;
no application deployment or additional access token was created.

| Source                                                 | Observed result                                                                                                                                                                        | Limit                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Cloudflare account inventory and Pages deployment view | Selected Free account, one `flyeye-staging` project, intended canonical hostname, no Git connection and no first deployment.                                                           | Empty project only; no frontend, callback or hosted workflow acceptance.                        |
| Cloudflare dashboard project metadata response         | Read-only response for the selected account's `/pages/projects/flyeye-staging` independently supplied its opaque `id`, matching `name` and `subdomain`; recorded in the target record. | No headers, credentials or raw response retained; no configuration change.                      |
| Supabase organization/project reads                    | Selected organization Free; exact Singapore region; project `ACTIVE_HEALTHY`, database host verified and PostgreSQL `17.11.0.011`.                                                     | Host identity, not direct-connection feasibility or runtime acceptance.                         |
| Supabase inventories and read-only counts              | Zero public tables, migrations, Edge Functions, Auth users, Storage buckets and objects.                                                                                               | Provider baseline components exist; application configuration and no-send enforcement untested. |
| Owner confirmation                                     | Bitwarden MFA sign-in, independent recovery kit, password-protected encrypted backup with separately recoverable password, and synthetic-note import with original retained.           | Owner-operated and reported; no independent vault inspection or account-loss recovery test.     |

P1's [exact-merge CI](https://github.com/killroyZULU/FlyEye/actions/runs/41555458153)
passed on `02fcaf7a1b5e7bdc9a935b9af7729d8f811554e0`. Historical bootstrap HTTP 503
and password transport-socket-closed causes remain unresolved; later passes do
not establish their causes. P3a final-head evidence belongs to
[issue #215](https://github.com/killroyZULU/FlyEye/issues/215) and its linked PR.

## P3a verification map

The offline [preflight suite](../../../scripts/lib/feat-003-staging-preflight.test.mjs)
and [manifest suite](../../../scripts/lib/feat-003-staging-manifest.test.mjs) map
the bounded contract as follows. Passing results and exact revision are recorded
in the linked PR; this map does not claim hosted execution.

| Requirement                                                                            | Test locator / evidence                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [P3A-AC01](FEAT-003_SYNTHETIC_STAGING_BASELINE.md#p3a-exact-target-repository-binding) | `pins the checked-in manifest to the independently verified P2 identities`; P2 identity sources above.                                                                                                                                                              |
| [P3A-AC02](FEAT-003_SYNTHETIC_STAGING_BASELINE.md#p3a-exact-target-repository-binding) | `rejects self-consistent substitution of %s despite matching review and hashes`, `rejects a different coherent project even when every supplied binding agrees`, missing-field cases, and `rejects an unreviewed manifest before parsing package or review inputs`. |
| [P3A-AC03](FEAT-003_SYNTHETIC_STAGING_BASELINE.md#p3a-exact-target-repository-binding) | P1 map above, `reports consistency only, without granting execution or changing inputs`, `guardedCall` and complete dependency-graph capability guard.                                                                                                              |
| [P3A-AC04](FEAT-003_SYNTHETIC_STAGING_BASELINE.md#p3a-exact-target-repository-binding) | Manifest suite `FEAT-003 protected function configuration`; unchanged [runtime configuration tests](../../../supabase/functions/_shared/edge-runtime-configuration.test.ts) and scoped diff review.                                                                 |
| [P3A-AC05](FEAT-003_SYNTHETIC_STAGING_BASELINE.md#p3a-exact-target-repository-binding) | Required check and independent-review receipts in the linked PR; database/runtime results supplied by disposable CI, without resetting existing local stacks.                                                                                                       |
