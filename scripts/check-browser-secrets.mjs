import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const browserRoots = ['src', 'public', 'index.html', '.env.example'];
const repositoryRoots = [
  '.env.example',
  '.github',
  'docs',
  'public',
  'scripts',
  'src',
  'supabase',
  'tests',
];
if (existsSync('dist')) browserRoots.push('dist');
if (process.argv.includes('--require-dist') && !existsSync('dist')) {
  throw new Error(
    'dist is required for the browser-output secret check. Run the production build first.',
  );
}

function filesUnder(target) {
  if (!existsSync(target)) return [];
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target, { withFileTypes: true }).flatMap((entry) =>
    filesUnder(path.join(target, entry.name)),
  );
}

function hasServiceRoleJwt(content) {
  const jwtPattern = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
  for (const candidate of content.match(jwtPattern) ?? []) {
    try {
      const payload = JSON.parse(
        Buffer.from(candidate.split('.')[1], 'base64url').toString('utf8'),
      );
      if (payload?.role === 'service_role') return true;
    } catch {
      // A malformed JWT-like string is not a credential match.
    }
  }
  return false;
}

const secretPrefixPattern = new RegExp(['sb', 'secret', '[A-Za-z0-9_-]{16,}'].join('_'), 'i');
const viteServerKeyPattern = /VITE_[A-Z0-9_]*(?:SERVICE_ROLE|SECRET_KEY)[A-Z0-9_]*/;
const findings = new Set();

for (const file of repositoryRoots.flatMap(filesUnder)) {
  const content = readFileSync(file, 'utf8');
  if (secretPrefixPattern.test(content) || hasServiceRoleJwt(content)) {
    findings.add(file);
  }
}

for (const file of browserRoots.flatMap(filesUnder)) {
  const content = readFileSync(file, 'utf8');
  if (viteServerKeyPattern.test(content)) {
    findings.add(file);
  }
}

if (findings.size > 0) {
  process.stderr.write(
    `Server-only Supabase key material found in source or browser output: ${[...findings].join(', ')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    'No service-role or secret Supabase keys found in repository source or browser output.\n',
  );
}
