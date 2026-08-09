# Risk-Triggered Review Record

Use this template only when a legal, aviation, privacy, security, accessibility, customer, operations, penetration-test, hosted, real-data, or production claim inherently requires qualified human evidence. Routine bounded local work uses automated verification and separate agent review under `AGENTS.md`.

## Review target

- Feature or release:
- Commit/build/migration identifiers:
- Environment and data classification:
- Evidence package:
- Review domain:
- Explicitly excluded claims:

## Reviewer

- Name and organization:
- Relevant role and competence:
- Independence or conflict disclosure:
- Review date:

## Questions and evidence

| ID | Question | Evidence examined | Finding |
|---|---|---|---|
| REV-01 | Does the target satisfy the applicable requirement and remain inside its authority boundary? | | Pass / Finding / Not reviewed |
| REV-02 | Are material failure, misuse, and recovery cases covered? | | Pass / Finding / Not reviewed |
| REV-03 | Are assumptions and limitations accurate for the claimed lifecycle gate? | | Pass / Finding / Not reviewed |

Add domain-specific questions only when they change the review decision. Do not copy the complete feature specification into this record.

## Findings

| Finding ID | Severity | Requirement or evidence | Required action | Owner | Resolution evidence |
|---|---|---|---|---|---|
| | | | | | |

Material unresolved findings block only the affected claim or gate. They do not silently authorize broader product, hosted, real-data, deployment, or production behavior.

## Disposition

- Scope reviewed:
- Accepted evidence:
- Unresolved findings:
- Claim or gate supported:
- Claims or gates not supported:
- Reviewer acknowledgement:

Store detailed technical output at its existing evidence source and link to it. Keep this record concise, attributable, and specific to the decision being reviewed.
