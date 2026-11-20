import unittest

from local_instructor_checkpoints import collect


class InstructorCheckpointTests(unittest.TestCase):
    def test_actual_prefix_and_both_line_endings(self):
        evidence = collect([
            "Instructor checkpoint passed: create-candidate\n",
            "Instructor checkpoint passed: browser-exact-profile\r\n",
        ])
        self.assertEqual(evidence["checkpoints"], ["create-candidate", "browser-exact-profile"])
        self.assertFalse(evidence["checkpointEvidenceComplete"])

    def test_only_exact_allowlisted_labels_survive(self):
        evidence = collect([
            "create-candidate",
            "other: Instructor checkpoint passed: create-candidate",
            "Instructor checkpoint passed:create-candidate",
            "Instructor checkpoint passed:  create-candidate",
            "Instructor checkpoint passed: create-candidate extra",
            "Instructor checkpoint passed: create-candidate ",
            "Instructor checkpoint passed: unrecognized-synthetic-label",
        ])
        self.assertEqual(evidence, {
            "checkpoints": [], "released": False, "checkpointEvidenceComplete": False,
        })

    def test_complete_order_and_release_are_required(self):
        labels = """owned-target-empty-mail-and-journal create-candidate establish-student
                    create-admin-subject issue-local-grant protected-admin-onboarding
                    protected-self-enrollment protected-role-assignment browser-instructor-sign-in
                    browser-exact-profile browser-directory-denied browser-worker-group-listener-closed
                    final-readback-and-empty-mail owned-teardown""".split()
        lines = ["Instructor checkpoint passed: " + name for name in labels]
        end = ["Instructor proof complete."]
        self.assertTrue(collect(lines + end)["checkpointEvidenceComplete"])
        for case in [lines, end, end + lines, lines + end + end, lines + end + lines[:1],
                     lines[1:] + end, lines[:1] + lines + end,
                     [lines[1], lines[0]] + lines[2:] + end]:
            with self.subTest(case=case):
                self.assertFalse(collect(case)["checkpointEvidenceComplete"])


if __name__ == "__main__":
    unittest.main()
