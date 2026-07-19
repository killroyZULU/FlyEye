# Risk Register

Scale: Probability (P) and Impact (I) are Low/Medium/High/Very High. Owners and due dates must be assigned when the project team/pilot is confirmed.

| ID | Risk | P | I | Preventive/mitigating controls | Trigger/contingency |
|---|---|---|---|---|---|
| R-01 | MVP scope expands across all modules | High | High | Charter, MoSCoW, stage gates, bounded specs | Defer/rebaseline; reject mixed mega-PRs |
| R-02 | School workflows vary materially | High | High | Multi-school discovery, configuration model | Categorize customization; avoid forks |
| R-03 | Aviation rule is misinterpreted | Medium | Very High | Official source register, SME approval, traceability | Disable affected rule/workflow; correct with controlled release |
| R-04 | AI-generated code introduces hidden defect | High | High | Small slices, tests, independent review, staging | Stop/revert/forward-fix; expand regression evidence |
| R-05 | Cross-tenant data exposure | Medium | Very High | Defense-in-depth tenancy and negative tests | Critical incident, contain, notify, investigate |
| R-06 | Restricted personal data exposed | Medium | Very High | Minimization, MFA, private files, logging, DPA/PIA | Incident response and controller/DPO assessment |
| R-07 | Incorrect W&B result | Low–Medium | Very High | Deterministic decimal engine, verified sources, boundary/mutation tests | Remove capability from use; preserve evidence; review all affected records |
| R-08 | Audit record missing or altered | Medium | Very High | Central append-only evidence; fail closed | Block sensitive action; investigate integrity |
| R-09 | Unreliable internet disrupts work | High | High | Limited offline drafts, sync status, parallel process | Use approved fallback; no offline final authority |
| R-10 | Users resist replacing paper | High | High | Participatory design, training, parallel pilot | Revise workflow; gradual adoption |
| R-11 | Pilot partner withdraws | Medium | High | Validate across ≥3 schools, alternate contacts | Pause/recruit alternative; preserve generic product scope |
| R-12 | No quality dataset for prediction | High | Medium | Structured deterministic data first | Defer predictive AI |
| R-13 | AI leaks data or follows prompt injection | Medium | High | Redaction, task endpoints, provider terms, schema, human review | Kill switch/provider disablement; incident review |
| R-14 | Malicious document upload | Medium | High | Signature/size validation, quarantine, scan, private storage | Isolate/delete under evidence procedure; rotate affected access |
| R-15 | Dependency/supply-chain compromise | Medium | High | Lockfiles, scanning, SBOM, reviewed actions/packages | Patch/remove; assess exposure and releases |
| R-16 | Destructive migration/data loss | Medium | Very High | Reviewed migration, staging rehearsal, backups, expand/contract | Stop deployment; restore/forward-fix and verify |
| R-17 | Recovery targets are not achievable | Medium | High | Quarterly drills and measured RPO/RTO | Re-architect/tier change; revise contractual claim |
| R-18 | Cloud cost exceeds viable pricing | Medium | High | Budgets/alerts, load/cost model, tiered features | Optimize/tier/reprice before scale |
| R-19 | Support burden overwhelms small team | High | High | Observability, runbooks, configurable product, staged customers | Limit onboarding; hire/partner or revise SLA |
| R-20 | Custom requests fragment product | High | High | Change control and product classification | Price/defer/reject customization |
| R-21 | Legal/privacy roles or retention unclear | Medium | Very High | DPA, PIA, DPO/legal review before real data | Do not process affected data until resolved |
| R-22 | External weather/NOTAM/provider unavailable or stale | Medium | High | Source/freshness, timeout, fallback, no AI authority | Show unavailable/stale; use approved official process |
| R-23 | Account compromise/privilege abuse | Medium | Very High | MFA, least privilege, reauth, access reviews, alerts | Revoke, contain, investigate, notify as required |
| R-24 | Product is marketed as CAAP-approved without basis | Medium | High | Approved claims register and legal/SME review | Correct materials; notify customers if material |
| R-25 | RLS policy is missing or overly broad | Medium | Very High | Deny-by-default migrations, SQL policy tests, independent review | Disable affected access; critical incident assessment |
| R-26 | Supabase service-role key is exposed | Low–Medium | Very High | Server-only secrets, bundle/secret scanning, restricted CI | Rotate immediately; inspect logs and tenant exposure |
| R-27 | Database backup succeeds but Storage files are unrecoverable | Medium | Very High | Separate object backup/export and reconciliation drills | Restore alternate copy; identify affected records and notify |
| R-28 | Direct client write bypasses protected workflow | Medium | Very High | Revoke sensitive grants; RLS `WITH CHECK`; protected commands and tests | Disable path, review affected records, correct audit/state |

Review monthly, before every gate/release, and after incidents or material changes. Record residual risk, owner, action date, evidence, and formal acceptance.
