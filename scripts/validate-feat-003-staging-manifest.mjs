import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseFeat003StagingManifest,
  validateFeat003RepositoryConfiguration,
} from './lib/feat-003-staging-manifest.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.resolve(repositoryRoot, 'config', 'feat-003-staging-environment.json');
const supabaseConfigPath = path.resolve(repositoryRoot, 'supabase', 'config.toml');
const edgeEnvironmentExamplePath = path.resolve(
  repositoryRoot,
  'supabase',
  'functions',
  '.env.example',
);

try {
  const parsed = parseFeat003StagingManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  validateFeat003RepositoryConfiguration(
    await readFile(supabaseConfigPath, 'utf8'),
    await readFile(edgeEnvironmentExamplePath, 'utf8'),
  );
  process.stdout.write(
    parsed.enabled
      ? 'FEAT-003 staging manifest is structurally ready for separate review.\n'
      : 'FEAT-003 staging manifest is disabled.\n',
  );
} catch {
  process.stderr.write('FEAT-003 staging manifest validation failed.\n');
  process.exitCode = 1;
}
