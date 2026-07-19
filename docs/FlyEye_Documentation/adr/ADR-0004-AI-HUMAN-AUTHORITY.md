# ADR-0004: AI is optional and human-supervised

- Status: Accepted
- Date: 2026-07-17

## Context

AI may structure comments, summarize source text, classify reports, and later identify patterns, but aviation-adjacent decisions and personal data create safety, privacy, accuracy, and accountability risks.

## Decision

AI is an optional provider-independent assistance layer. It receives minimized permission-checked context, produces restricted structured suggestions, and requires human review/edit/reject/accept. It cannot access production data directly, change final status, approve dispatch, release aircraft, calculate authoritative W&B, or mark competence. Core workflows operate without AI.

## Consequences

Positive: reduces single-point-of-failure and unsafe automation; supports provider changes and controlled adoption.

Tradeoffs: added review UX, provider governance, AI evaluation, and limited automation.

## First candidate

Instructor Comment Assistant after the non-AI assessment workflow is stable and privacy/security review is complete.

