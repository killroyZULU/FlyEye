# Change Log

This log records material product, architecture, security, and documentation milestones. Git commits, pull requests, CI, migrations, and feature traceability records hold the detailed evidence.

Entries should normally be no more than 100 words. Do not use this file as an implementation diary or repeat evidence already recorded elsewhere.

## Unreleased

- Consolidated active documentation around one canonical home per rule. Added `CURRENT_STATE.md`, the Documentation Standard, automated size/link/duplication checks, and concise agent-writing rules. Removed superseded process chronology and repetitive status prose from active entry-point documents without changing product, security, tenancy, privacy, audit, aviation, or human-authority boundaries.

## 0.4.0 — 2026-08-09

- Merged FEAT-003 hosted-synthetic hardening through PR #8 at `48ba984`. The target manifest remains disabled and target-free; no hosted issuer, provider activation, hosted run, real data, deployment, or production path was added.

## 0.3.0 — 2026-08-02

- Merged FEAT-003 Organization Admin and MFA Onboarding through PR #7 at `00dcfd2`. The bounded local synthetic implementation added protected first-admin bootstrap, TOTP onboarding, tenant isolation, atomic audit, fail-closed provider consistency, rate controls, and verified synthetic runtime coverage. Hosted validation and later lifecycle gates remain separate.
- Adopted autonomous bounded delivery through a green review-ready pull request. Merge, real data, production, destructive actions, branch deletion, and unsupported regulated authority remain outside the standing envelope.

## 0.2.0 — 2026-07-27

- Merged FEAT-002 Password Recovery through PR #5 and its closure documentation through PR #6. The feature established non-enumerating recovery, password-session restrictions, session revocation, fail-closed audit behavior, and synthetic verification. Hosted provider behavior and production gates remain open.
- Merged project governance decisions covering commercial direction, universal MFA before real-data use, multi-organization membership, separation of duties, synthetic-only development, and pilot boundaries.

## 0.1.0 — 2026-07-19

- Established the React, TypeScript, Vite, and Supabase MVP architecture in ADR-0005.
- Merged FEAT-001 Login and initial RBAC, including local Auth, server-derived membership, privileged-role MFA enforcement, deny-by-default RLS, protected bootstrap, audit evidence, and cross-organization tests.
- Added verification-only GitHub Actions quality gates. CI does not deploy.

## Change process

- Update this file only for a material milestone or policy change.
- Link or identify the relevant feature, ADR, pull request, or evidence source.
- Replace an unreleased entry when it becomes a dated release entry; do not duplicate it.
- Keep current project status in `CURRENT_STATE.md`.
