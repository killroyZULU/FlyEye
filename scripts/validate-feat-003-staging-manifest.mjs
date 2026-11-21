import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStagingNoSend } from './lib/feat-003-staging-no-send.mjs';

import {
  requireFeat003ReviewedStagingManifest,
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
  validateStagingNoSend(
    await readFile(manifestPath, 'utf8'),
    await readFile(path.resolve(repositoryRoot, 'config/feat-003-staging-auth.json'), 'utf8'),
  );
  requireFeat003ReviewedStagingManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  validateFeat003RepositoryConfiguration(
    await readFile(supabaseConfigPath, 'utf8'),
    await readFile(edgeEnvironmentExamplePath, 'utf8'),
  );
  process.stdout.write(
    'FEAT-003 reviewed staging target validated; hosted execution not authorized.\n',
  );
} catch {
  process.stderr.write('FEAT-003 staging manifest validation failed.\n');
  process.exitCode = 1;
}
