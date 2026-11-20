import { runAdminBrowserProof } from './lib/no-send-local-project.mjs';
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
  await runAdminBrowserProof();
  process.stdout.write('Admin proof complete.\n');
} catch {
  process.stderr.write('Admin proof stopped. Preserve the journal and owned resources.\n');
  process.exitCode = 1;
}
