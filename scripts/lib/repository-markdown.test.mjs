// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { markdownFormatScope, repositoryMarkdown } from './repository-markdown.mjs';
import { formatDocumentation } from './documentation-format.mjs';

const fixtures = [];
const project = process.cwd();

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'flyeye-markdown-'));
  fixtures.push(root);
  return root;
}

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(root, name, content = '# Heading\n') {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function baseline(root) {
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'baseline',
  );
  return git(root, 'rev-parse', 'HEAD').trim();
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Git-aware Markdown inventory', () => {
  it('includes tracked and new documents, honors ignores and negations, and handles deletion', () => {
    const root = fixture();
    write(root, '.gitignore', 'scratch/\n.pnpm-store/\ndrafts/*\n!drafts/keep.md\n');
    write(root, 'tracked.md');
    write(root, 'deleted.md');
    baseline(root);
    rmSync(join(root, 'deleted.md'));
    write(root, 'new guide Café.MD');
    write(root, 'scratch/broken.md', '[broken](missing.md)');
    write(root, '.pnpm-store/noise.md');
    write(root, 'drafts/ignored.md');
    write(root, 'drafts/keep.md');
    write(root, 'scratch/tracked.md');
    git(root, 'add', '-f', 'scratch/tracked.md');
    expect(repositoryMarkdown(root)).toEqual([
      'drafts/keep.md',
      'new guide Café.MD',
      'scratch/tracked.md',
      'tracked.md',
    ]);
  });

  it('fails instead of silently passing outside a Git checkout', () => {
    expect(() => repositoryMarkdown(fixture())).toThrow('readable Git checkout');
  });

  it('makes the real documentation checker reject new unstaged broken links, ignoring scratch', () => {
    const root = fixture();
    cpSync(resolve(project, 'scripts'), join(root, 'scripts'), { recursive: true });
    for (const name of [
      'AGENTS.md',
      'docs/FlyEye_Documentation/README.md',
      'docs/FlyEye_Documentation/CURRENT_STATE.md',
      'docs/FlyEye_Documentation/01_MASTER_HANDOFF.md',
      'docs/FlyEye_Documentation/09_AI_DEVELOPMENT_GUIDE.md',
      'docs/FlyEye_Documentation/17_PRODUCT_AND_GOVERNANCE_DECISIONS.md',
    ])
      write(root, name, `# ${name}\n`);
    write(root, '.gitignore', 'scratch/\n');
    git(root, 'init', '-q');
    write(root, 'scratch/ignored.md', '[broken](missing.md)');
    const run = () =>
      spawnSync(process.execPath, [join(root, 'scripts/check-documentation.mjs')], {
        cwd: root,
        encoding: 'utf8',
      });
    const clean = run();
    expect(clean.status, clean.stderr).toBe(0);
    write(root, 'new.md', '[broken](missing.md)');
    const broken = run();
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain('new.md');
    expect(broken.stderr).not.toContain('scratch/ignored.md');
  });
});

describe('gradual Markdown formatting scope', () => {
  it('rejects unformatted changed guidance despite Prettier CLI ignores, preserving legacy and code examples', async () => {
    const root = fixture();
    for (const name of ['.prettierrc.json', '.prettierignore'])
      cpSync(resolve(project, name), join(root, name));
    const legacy = '# Legacy\n\n*   untouched\n';
    const legacyName = 'docs/FlyEye_Documentation/legacy.md';
    write(root, legacyName, legacy);
    write(root, 'AGENTS.md');
    const ref = baseline(root);
    const code = '```js\nconst   example={a:1}\n```';
    write(root, 'AGENTS.md', `# Heading\n\n*   changed\n\n${code}\n`);
    write(root, 'docs/new.MD', `# New\n\n*   new\n\n${code}\n`);
    const checked = await formatDocumentation(root, { baseline: ref });
    expect(checked.failures).toEqual(['AGENTS.md', 'docs/new.MD']);
    expect(checked.deferred).toEqual([legacyName]);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('*   changed');
    const written = await formatDocumentation(root, { baseline: ref, write: true });
    expect(written.written).toEqual(['AGENTS.md', 'docs/new.MD']);
    expect((await formatDocumentation(root, { baseline: ref })).failures).toEqual([]);
    expect(readFileSync(join(root, legacyName), 'utf8')).toBe(legacy);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain(code);
    expect(readFileSync(join(root, 'docs/new.MD'), 'utf8')).toContain(code);
  });

  it('keeps a fixed baseline across commits and includes staged, unstaged and new files', () => {
    const root = fixture();
    write(root, 'docs/FlyEye_Documentation/legacy.md', '# Legacy\n\n*   untouched\n');
    write(root, '.github/pull_request_template.md');
    write(root, 'committed.md');
    write(root, 'staged.md');
    write(root, 'unstaged.md');
    write(root, '.gitignore', 'scratch/\n');
    const ref = baseline(root);
    write(root, 'committed.md', '# Changed\n');
    git(root, 'add', 'committed.md');
    git(
      root,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'change',
    );
    write(root, 'staged.md', '# Staged\n');
    git(root, 'add', 'staged.md');
    write(root, 'unstaged.md', '# Unstaged\n');
    write(root, 'new.md');
    write(root, 'scratch/ignored.md');
    expect(markdownFormatScope(root, ref)).toEqual({
      checked: [
        '.github/pull_request_template.md',
        'committed.md',
        'new.md',
        'staged.md',
        'unstaged.md',
      ],
      deferred: ['docs/FlyEye_Documentation/legacy.md'],
    });
  });

  it('fails when the adoption baseline is unavailable', () => {
    const root = fixture();
    write(root, 'guide.md');
    baseline(root);
    expect(() => markdownFormatScope(root, 'missing-baseline')).toThrow('adoption history');
  });

  it('does not defer a staged change masked by a working-tree restoration to baseline', () => {
    const root = fixture();
    const name = 'docs/FlyEye_Documentation/restored.md';
    const original = '# Legacy\n\n*   original\n';
    write(root, name, original);
    const ref = baseline(root);
    write(root, name, '# Staged change\n');
    git(root, 'add', name);
    write(root, name, original);
    expect(markdownFormatScope(root, ref)).toEqual({ checked: [name], deferred: [] });
  });
});
