"""Collect sanitized Instructor checkpoint evidence from an existing output stream."""

import json
import sys


PREFIX = "Instructor checkpoint passed: "
EXPECTED = (
    "owned-target-empty-mail-and-journal",
    "create-candidate",
    "establish-student",
    "create-admin-subject",
    "issue-local-grant",
    "protected-admin-onboarding",
    "protected-self-enrollment",
    "protected-role-assignment",
    "browser-instructor-sign-in",
    "browser-exact-profile",
    "browser-directory-denied",
    "browser-worker-group-listener-closed",
    "final-readback-and-empty-mail",
    "owned-teardown",
)


def collect(lines):
    checkpoints = []
    released = False
    complete_at_release = False
    for raw in lines:
        line = raw.rstrip("\r\n")
        if line.startswith(PREFIX):
            checkpoint = line.removeprefix(PREFIX)
            if checkpoint in EXPECTED:
                checkpoints.append(checkpoint)
        elif line == "Instructor proof complete.":
            complete_at_release = not released and tuple(checkpoints) == EXPECTED
            released = True
    return {
        "checkpoints": checkpoints,
        "released": released,
        "checkpointEvidenceComplete": complete_at_release and tuple(checkpoints) == EXPECTED,
    }


if __name__ == "__main__":
    evidence = collect(sys.stdin)
    print(json.dumps(evidence))
    sys.exit(0 if evidence["checkpointEvidenceComplete"] else 1)
