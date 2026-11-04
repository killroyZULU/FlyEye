import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeStagingGrant } from './lib/feat-003-staging-issuer-command.mjs';
import {
  isLocalIssuerPath,
  loadIssuerInputs,
  readIssuerFile,
} from './lib/feat-003-staging-issuer-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);

try {
  if (
    args.length !== 4 ||
    args[0] !== '--package-dir' ||
    args[2] !== '--psql' ||
    !isLocalIssuerPath(args[3])
  )
    throw new Error('Invalid arguments.');
  const input = await loadIssuerInputs(root, args[1]);
  const transaction = (
    await readIssuerFile(path.join(root, 'scripts/sql/feat-003-staging-grant.sql'))
  ).toString();
  // Intentionally do not inherit PG*, HOME, APPDATA, service files, password variables,
  // startup hooks, locale overrides, or environment-selected connection targets.
  const environment = () =>
    Object.fromEntries(
      ['PATH', 'SystemRoot', 'WINDIR']
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    );
  const result = await executeStagingGrant(input, transaction, {
    isInteractive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
    readTool: () => readIssuerFile(args[3], 64 * 1024 * 1024),
    cleanCheckout: () => {
      const status = spawnSync(
        'git',
        [
          '--no-optional-locks',
          '-c',
          'core.fsmonitor=false',
          'status',
          '--porcelain=v1',
          '--untracked-files=all',
        ],
        {
          cwd: root,
          env: environment(),
          encoding: 'utf8',
          timeout: 10000,
          maxBuffer: 4096,
          windowsHide: true,
        },
      );
      if (status.status !== 0 || status.stdout !== '') return false;
      const head = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        env: environment(),
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 4096,
        windowsHide: true,
      });
      return head.status === 0 && head.stdout.trim() === input.checkoutRevision;
    },
    supportedTool: () => {
      const version = spawnSync(args[3], ['--version'], {
        env: environment(),
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 4096,
        windowsHide: true,
      });
      return (
        version.status === 0 &&
        /^psql \(PostgreSQL\) 17\.\d+(?:[^\r\n]*)\r?\n?$/.test(version.stdout)
      );
    },
    confirm: async () => {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await terminal.question(
          'Enter the separately authorized deployment approval reference: ',
        );
      } finally {
        terminal.close();
      }
    },
    run: (command) =>
      spawnSync(args[3], command.args, {
        input: command.input,
        env: environment(),
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 4096,
        windowsHide: true,
      }),
  });
  process.stdout.write(
    result === 'issued'
      ? 'FEAT-003 staging grant issued.\n'
      : 'FEAT-003 staging issuance outcome uncertain; stop and reconcile without retry.\n',
  );
  if (result !== 'issued') process.exitCode = 1;
} catch {
  process.stderr.write('FEAT-003 staging issuance rejected before issuance.\n');
  process.exitCode = 1;
}
