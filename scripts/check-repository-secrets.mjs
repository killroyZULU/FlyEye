import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const executable = process.env.GITLEAKS_PATH || 'gitleaks';
if (process.argv.includes('--dist') && (!existsSync('dist') || !statSync('dist').isDirectory())) {
  process.stderr.write('Secret scan blocked: build output directory dist is required.\n');
  process.exit(1);
}
const version = spawnSync(executable, ['version'], { encoding: 'utf8', windowsHide: true });
if (version.status !== 0 || version.stdout.trim() !== '8.30.1') {
  process.stderr.write(
    'Secret scan blocked: install verified Gitleaks 8.30.1 and set GITLEAKS_PATH or PATH.\n',
  );
  process.exit(1);
}

const configuration = fileURLToPath(new URL('../.gitleaks.toml', import.meta.url));
const common = [
  '--redact=100',
  '--no-banner',
  '--no-color',
  '--exit-code=1',
  `--config=${configuration}`,
];
const scans = process.argv.includes('--dist')
  ? [['browser output', ['dir', '--follow-symlinks', 'dist']]]
  : [
      [
        'committed history',
        ['git', '--log-opts=--all --full-history --diff-merges=first-parent', '.'],
      ],
      ['staged changes', ['git', '--pre-commit', '--staged', '.']],
      ['unstaged tracked changes', ['git', '--pre-commit', '.']],
    ];

for (const [label, options] of scans) {
  const result = spawnSync(executable, [...options, ...common], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    process.stderr.write(`Secret scan blocked: ${label}. Resolve findings before publication.\n`);
    process.exit(1);
  }
}

process.stdout.write(
  'Redacted secret scans passed. Stage new source files before prepublication checks.\n',
);
