import { analyzeRepository } from './lib/code-maintainability.mjs';

const result = await analyzeRepository(process.cwd());

if (result.errors.length > 0) {
  console.error('Code maintainability checks failed:');
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Code maintainability checks passed: ${result.fileCount} production TypeScript files, file budgets, module boundaries, and import cycles.`,
  );
}
