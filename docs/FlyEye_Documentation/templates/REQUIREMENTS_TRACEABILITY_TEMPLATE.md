# FEAT-XXX Traceability

## Evidence boundary

- Reviewed target:
- Verification date:
- Local/hosted/data boundary:
- Pull request and CI:
- Known limitations:

Do not repeat the feature specification or global project rules. Follow
[navigable evidence](../DOCUMENTATION_STANDARD.md#navigable-evidence): link IDs
to their definitions, exact test locators or immutable historical records.

## Requirements and results

| Requirement/AC ID | Design or control | Test/evidence ID | Result                | Limitation or later gate |
| ----------------- | ----------------- | ---------------- | --------------------- | ------------------------ |
|                   |                   |                  | Pass / Fail / Pending |                          |

## Evidence map

Use only when a table link needs additional locators or scope. Give each referenced
ID an ATX heading, a linked file plus exact test/suite/function/assertion locator,
and any uncovered scope. Link historical results separately with their original
target and run; source inspection alone is not execution evidence.

## Evidence rules

- One row per independently testable requirement or control.
- Do not mark `Pass` without reproducible evidence for the reviewed target.
- Record detailed output once; later unchanged reports link to it.
- Separate local synthetic, hosted synthetic, real-data, deployment, and production evidence.
- An agent review is not qualified independent human review or risk acceptance.
- Update this record when the requirement, implementation, test, source, reviewed target, or limitation changes.
