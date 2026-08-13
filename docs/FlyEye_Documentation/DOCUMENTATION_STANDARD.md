# Documentation Standard

## Purpose

FlyEye documentation must remain trustworthy, concise, and maintainable as the product grows. Shortening never permits weakening a security, tenancy, privacy, audit, aviation, or human-authority boundary.

The governing rule is **one fact, one canonical home**. Other documents link to that fact by document and requirement or decision ID instead of rewriting it.

## Canonical homes

| Information | Canonical home | Do not place in |
|---|---|---|
| Product requirements | `03_PRODUCT_REQUIREMENTS_SRS.md` | Handoff or change log prose |
| Architecture decisions | Accepted ADRs, summarized by `04_SYSTEM_ARCHITECTURE.md` | Feature evidence |
| Security controls | `08_SECURITY_REQUIREMENTS.md` | Repeated feature disclaimers |
| Active product-owner decisions | `17_PRODUCT_AND_GOVERNANCE_DECISIONS.md` | Feature chronology |
| Active work coordination | GitHub Issues and the FlyEye Delivery project | Requirements, durable decisions, or detailed evidence |
| Current project and feature state | `CURRENT_STATE.md` | Durable requirements or architecture |
| Bounded feature contract | Feature specification | Change log or handoff |
| Requirement-to-test result | Feature traceability record | Feature specification narrative |
| Historical implementation evidence | Git commits, pull requests, CI runs, and concise traceability links | README, handoff, or governance narrative |
| Material release/documentation milestone | `16_CHANGE_LOG.md` | Per-command or per-amendment diary |
| AI execution policy | `AGENTS.md` and `09_AI_DEVELOPMENT_GUIDE.md` | Every feature document |

## Writing rules

1. Write for the next engineer or reviewer, not for the conversation that produced the change.
2. Use plain language, concrete nouns, active voice, and short paragraphs.
3. State a boundary once. Link to it elsewhere.
4. Prefer requirement and decision IDs over paraphrased copies.
5. Record only information that changes implementation, verification, operation, or risk decisions.
6. Distinguish facts, decisions, assumptions, unresolved questions, and evidence.
7. Keep specifications prospective: outcome, scope, contracts, acceptance criteria, and planned verification.
8. Keep traceability retrospective: requirement, evidence location, result, limitation, and applicable gate.
9. Keep `CURRENT_STATE.md` current by replacing stale status; do not append a diary.
10. Keep the change log at milestone level. One entry should normally be at most 100 words and link to the pull request or evidence record when available.
11. Do not store prompt transcripts, approval scripts, repeated authorization boundaries, command-by-command logs, raw tool output, or narrative fingerprints in active documentation.
12. Do not add generic introductions, conclusions, benefits lists, or “best practice” prose that does not change a FlyEye decision.
13. Do not create a new Markdown file when an existing canonical document can own the information cleanly.
14. Do not update unrelated documents merely to make a change appear comprehensive.
15. Keep issues operational: link to canonical requirements, record only the bounded outcome, scope, acceptance, dependencies, and current coordination state, and close through the linked pull request.

## Size and structure budgets

The automated documentation check enforces budgets on active entry-point files. A budget is a design signal, not permission to omit a rule.

| Document | Budget |
|---|---:|
| `AGENTS.md` | 1,600 words |
| `README.md` | 900 words |
| `CURRENT_STATE.md` | 900 words |
| `01_MASTER_HANDOFF.md` | 1,500 words |
| `09_AI_DEVELOPMENT_GUIDE.md` | 1,600 words |
| `16_CHANGE_LOG.md` | 1,200 words |
| `17_PRODUCT_AND_GOVERNANCE_DECISIONS.md` | 2,000 words |
| New feature specification | 4,000 words |
| New feature traceability record | 2,500 words |

If a durable feature contract genuinely needs more space, split a focused reference from the specification and record the reason in both files. Do not increase a budget simply because generated prose exceeded it.

## Required document lifecycle

Before editing:

1. Identify the canonical owner of the information.
2. Search for existing statements and contradictions.
3. List the smallest files that need change.

While editing:

1. Replace stale text instead of appending another status paragraph.
2. Preserve stable IDs used by code, tests, or traceability.
3. Link to detailed evidence rather than duplicating it.
4. Remove superseded wording in the same change.

Before publication:

1. Run `pnpm check:docs` and formatting checks.
2. Review the diff for duplicated rules, accidental authority changes, stale status, broken links, and unnecessary prose.
3. Confirm every removed operative rule still has a canonical home.
4. Obtain the normal separate review required by `AGENTS.md`.

## Review questions

A documentation reviewer should be able to answer yes to each question:

- Is this the correct canonical file?
- Is the new text necessary to build, verify, operate, or govern FlyEye?
- Does it say something only once?
- Does it distinguish current state from history?
- Does it preserve all security, tenancy, privacy, audit, aviation, and human-authority controls?
- Could a competent engineer understand it without the originating chat?
- Is the same outcome expressible more directly without losing meaning?

If the answer to any question is no, revise before publication.
