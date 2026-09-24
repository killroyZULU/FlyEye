import { formatDocumentation } from './lib/documentation-format.mjs';

const args = process.argv.slice(2);
if (args.length !== 1 || !['--check', '--write'].includes(args[0])) {
  console.error('Usage: node scripts/format-documentation.mjs --check|--write');
  process.exit(1);
}

try {
  const scope = await formatDocumentation(process.cwd(), { write: args[0] === '--write' });
  for (const name of scope.written) console.log(`Formatted ${name}`);
  console.log(
    `Markdown formatting: ${scope.checked.length} checked; ${scope.deferred.length} unchanged legacy documents deferred (not format-verified).`,
  );
  if (scope.failures.length > 0) {
    console.error(`Run pnpm format:docs for: ${scope.failures.join(', ')}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Markdown formatting failed: ${error.message}`);
  process.exitCode = 1;
}
