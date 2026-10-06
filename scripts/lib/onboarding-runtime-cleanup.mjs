// Finish every owned cleanup step, but never turn a partial cleanup into success.
export async function runOnboardingCleanup(diagnostics, steps) {
  let failed = false;
  for (const [stage, operation] of steps) {
    try {
      await diagnostics.run(stage, operation);
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error('Synthetic onboarding cleanup failed.');
}
