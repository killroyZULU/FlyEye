import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const browserScanner = path.resolve('scripts/check-browser-secrets.mjs');
const repositoryScanner = path.resolve('scripts/check-repository-secrets.mjs');
const secretKey = ['sb', 'secret', 'synthetic-regression-value-only'].join('_');
const jwt = (role) =>
  [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify({ role })).toString('base64url'),
    'synthetic-signature',
  ].join('.');
const genericCredential = ['ghp', 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cD0fG3iJ6'].join('_');

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'flyeye-secret-scanner-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.equal(path.basename(root).startsWith('flyeye-secret-scanner-test-'), true);
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function write(root, file, content) {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function scan(script, root, args = [], env = process.env) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function runGit(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, 'Synthetic Git fixture command must succeed');
  return result.stdout.trim();
}

function initializeGit(root) {
  runGit(root, 'init', '--quiet');
  runGit(root, 'config', 'user.name', 'Synthetic scanner test');
  runGit(root, 'config', 'user.email', 'scanner@example.invalid');
  write(root, 'fixture.txt', 'ordinary configuration');
  runGit(root, 'add', 'fixture.txt');
  runGit(root, '-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'Synthetic clean fixture');
}

for (const location of ['dist/assets/app.js', 'index.html', 'src/config.ts']) {
  for (const [name, value] of [
    ['secret key', secretKey],
    ['service-role JWT', jwt('service_role')],
  ]) {
    test(`rejects ${name} in ${location} without disclosing it`, (t) => {
      const root = fixture(t);
      write(root, location, `window.configuration = ${JSON.stringify(value)};`);
      const result = scan(browserScanner, root);
      assert.equal(result.status, 1);
      assert.equal(`${result.stdout}${result.stderr}`.includes(value), false);
    });
  }
}

test('accepts publishable/anon keys and ordinary bundle text', (t) => {
  const root = fixture(t);
  write(root, 'dist/assets/app.js', JSON.stringify(['sb_publishable_synthetic', jwt('anon')]));
  assert.equal(scan(browserScanner, root, ['--require-dist']).status, 0);
});

test('rejects forbidden VITE names and a missing required build', (t) => {
  const root = fixture(t);
  assert.equal(scan(browserScanner, root, ['--require-dist']).status, 1);
  write(root, 'dist/assets/app.js', 'VITE_SERVICE_ROLE_KEY');
  assert.equal(scan(browserScanner, root, ['--require-dist']).status, 1);
});

test('fails closed when the general scanner is unavailable', (t) => {
  const root = fixture(t);
  const result = scan(repositoryScanner, root, [], {
    ...process.env,
    GITLEAKS_PATH: path.join(root, 'missing-scanner'),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Secret scan blocked/);
});

test('general browser scan rejects missing output and synthetic provider keys', (t) => {
  const root = fixture(t);
  assert.equal(scan(repositoryScanner, root, ['--dist']).status, 1);
  write(
    root,
    'dist/app.js',
    `publishable_key = sb_publishable_${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cD0fG'}`,
  );
  assert.equal(scan(repositoryScanner, root, ['--dist']).status, 0);
  write(
    root,
    'dist/app.js',
    `publishable_key = sb_publishable_synthetic; token = ${genericCredential}`,
  );
  const result = scan(repositoryScanner, root, ['--dist']);
  assert.equal(result.status, 1);
  assert.equal(`${result.stdout}${result.stderr}`.includes(genericCredential), false);
});

test('general scanner rejects staged, unstaged and historical synthetic credentials', (t) => {
  const root = fixture(t);
  const git = (...args) => runGit(root, ...args);
  initializeGit(root);
  assert.equal(scan(repositoryScanner, root).status, 0);

  const reject = () => {
    const result = scan(repositoryScanner, root);
    assert.equal(result.status, 1);
    assert.equal(`${result.stdout}${result.stderr}`.includes(genericCredential), false);
  };
  write(root, 'fixture.txt', `token = ${genericCredential}`);
  reject();
  git('add', 'fixture.txt');
  reject();
  git('-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'Synthetic credential fixture');
  write(root, 'fixture.txt', 'ordinary configuration');
  git('add', 'fixture.txt');
  git('-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'Remove synthetic fixture');
  reject();
});

test('general history scan includes credentials introduced only by a merge', (t) => {
  const root = fixture(t);
  const git = (...args) => runGit(root, ...args);
  initializeGit(root);
  const initial = git('rev-parse', 'HEAD');
  const cleanTree = git('rev-parse', 'HEAD^{tree}');
  const side = git('commit-tree', cleanTree, '-p', initial, '-m', 'Synthetic side parent');
  write(root, 'fixture.txt', `token = ${genericCredential}`);
  git('add', 'fixture.txt');
  const mergeTree = git('write-tree');
  const merge = git('commit-tree', mergeTree, '-p', initial, '-p', side, '-m', 'Synthetic merge');
  const cleaned = git('commit-tree', cleanTree, '-p', merge, '-m', 'Synthetic cleanup');
  git('update-ref', 'HEAD', cleaned);
  write(root, 'fixture.txt', 'ordinary configuration');
  git('add', 'fixture.txt');
  assert.equal(git('status', '--porcelain'), '');
  const result = scan(repositoryScanner, root);
  assert.equal(result.status, 1);
  assert.equal(`${result.stdout}${result.stderr}`.includes(genericCredential), false);
});
