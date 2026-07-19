import { spawnSync } from 'node:child_process';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const cliPath = path.resolve('node_modules', 'supabase', 'dist', 'supabase.js');
const prettierPath = path.resolve('node_modules', 'prettier', 'bin', 'prettier.cjs');
const targetPath = path.resolve('src', 'lib', 'database.types.ts');
const temporaryPath = path.resolve('src', 'lib', 'database.types.generated.ts');

const result = spawnSync(
  process.execPath,
  [cliPath, 'gen', 'types', '--local', '--lang', 'typescript'],
  {
    encoding: 'utf8',
  },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'Supabase type generation failed.\n');
  process.exitCode = result.status ?? 1;
} else if (!result.stdout.includes('export type Database')) {
  process.stderr.write('Supabase returned an unexpected type-generation response.\n');
  process.exitCode = 1;
} else {
  try {
    writeFileSync(temporaryPath, result.stdout, { encoding: 'utf8', flag: 'wx' });
    const formatResult = spawnSync(process.execPath, [prettierPath, '--write', temporaryPath], {
      encoding: 'utf8',
    });
    if (formatResult.status !== 0) {
      throw new Error(formatResult.stderr || 'Generated database type formatting failed.');
    }
    renameSync(temporaryPath, targetPath);
    process.stdout.write(`Generated ${targetPath}\n`);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}
