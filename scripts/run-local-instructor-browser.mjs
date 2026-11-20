import { runInstructorBrowserProof } from './lib/no-send-local-project.mjs';
if (
  process.platform !== 'linux' ||
  process.version !== 'v24.14.0' ||
  process.geteuid() !== 1000 ||
  process.argv.length !== 2 ||
  process.env.CI ||
  process.env.DOCKER_HOST ||
  process.env.DOCKER_CONTEXT
)
  throw new Error('Local fixture prerequisites rejected.');
try {
  await runInstructorBrowserProof();
  // Returning from the outer operation also verifies inventory lock release.
  process.stdout.write('Instructor proof complete.\n');
} catch {
  process.stderr.write(
    'Instructor proof stopped. Inspect the last verified checkpoint and owned journal.\n',
  );
  process.exitCode = 1;
}
