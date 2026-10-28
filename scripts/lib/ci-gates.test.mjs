// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyProse,
  classifyRepository,
  prosePath,
  qualityGate,
} from '../classify-ci-change.mjs';

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

// Deliberately require the workflow's explicit, unconditional application steps.
// Unsupported restructuring fails this contract instead of guessing YAML semantics.
function missingApplicationGates(source) {
  const application = source.split('\n  application:')[1]?.split('\n  database:')[0] ?? '';
  const steps = application.split(/\n {6}- name:/u).slice(1);
  return scripts['verify:app'].split(' && ').filter((command) => {
    const name = command.replace(/^pnpm /u, '');
    return !steps.some((step) => {
      const run = step.match(/^ {8}run: (.+)$/mu)?.[1]?.trim();
      return (
        !/^ {8}(?:if|continue-on-error):/mu.test(step) && (run === command || run === scripts[name])
      );
    });
  });
}

describe('application CI gate parity', () => {
  it('requires every advertised local application gate as a blocking CI step', () => {
    expect(missingApplicationGates(workflow)).toEqual([]);
  });

  it('detects an omitted, conditional or non-blocking staging configuration validator', () => {
    const command = '        run: pnpm validate:feat003-staging';
    expect(workflow).toContain(command);
    for (const replacement of [
      '',
      `        if: false\n${command}`,
      `        continue-on-error: true\n${command}`,
    ]) {
      expect(missingApplicationGates(workflow.replace(command, replacement))).toContain(
        'pnpm validate:feat003-staging',
      );
    }
  });

  it('includes the dedicated Markdown gate in both normal format commands', () => {
    expect(scripts['format:check'].split(' && ')).toContain('pnpm format:docs:check');
    expect(scripts.format.split(' && ')).toContain('pnpm format:docs');
  });
});

const narrative =
  '# Change Log\n\nInstructions stay unchanged.\n\n## Unreleased\n\n- Clarified historical wording for readers.\n';
const reflow = narrative.replace('wording for', 'wording\n  for');
const temporaryRepositories = [];

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fixture(after = reflow, extraPath) {
  const cwd = mkdtempSync(join(tmpdir(), 'flyeye-ci-route-'));
  temporaryRepositories.push(cwd);
  mkdirSync(dirname(join(cwd, prosePath)), { recursive: true });
  writeFileSync(join(cwd, prosePath), narrative);
  runGit(cwd, ['init', '--initial-branch=fixture']);
  const commit = () => {
    runGit(cwd, ['add', '--all']);
    runGit(cwd, [
      '-c',
      'user.name=Synthetic Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'synthetic fixture',
    ]);
    return runGit(cwd, ['rev-parse', 'HEAD']);
  };
  const base = commit();
  writeFileSync(join(cwd, prosePath), after);
  if (extraPath) {
    mkdirSync(dirname(join(cwd, extraPath)), { recursive: true });
    writeFileSync(join(cwd, extraPath), 'synthetic fixture\n');
  }
  const head = commit();
  return { cwd, base, head, checkout: head, eventName: 'pull_request', commit };
}

afterEach(() => {
  for (const path of temporaryRepositories.splice(0)) {
    if (dirname(path) !== tmpdir() || !path.startsWith(join(tmpdir(), 'flyeye-ci-route-')))
      throw new Error('Unexpected fixture path');
    rmSync(path, { recursive: true, force: true });
  }
});

describe('conservative non-normative prose classification', () => {
  it('accepts only unchanged words in supported retrospective spacing/reflow', () => {
    expect(classifyProse(narrative, reflow).route).toBe('prose');
    expect(classifyProse(reflow, narrative).route).toBe('prose');
    expect(classifyProse(narrative, narrative.replace('wording for', 'wording  for')).route).toBe(
      'prose',
    );
  });

  it.each([
    ['empty diff', narrative],
    ['changed claim', narrative.replace('Clarified', 'Approved')],
    ['negation', narrative.replace('wording', 'no wording')],
    [
      'instruction',
      narrative.replace('Instructions stay unchanged.', 'Instructions now allow skipped review.'),
    ],
    ['heading', narrative.replace('Unreleased', 'Released')],
    ['new block', `${narrative}\n- Clarified another item.\n`],
    ['deleted block', narrative.replace('- Clarified historical wording for readers.\n', '')],
    ['blank line', narrative.replace('wording for', 'wording\n\n  for')],
    ['nested bullet', narrative.replace('wording for', 'wording\n  - for')],
    ['code indentation', narrative.replace('wording for', 'wording\n    for')],
    ['hard break', narrative.replace('wording for', 'wording  \n  for')],
    ['tab', narrative.replace('wording for', 'wording\tfor')],
    ['nul', `${reflow}\0`],
    ['unicode whitespace', narrative.replace('wording for', 'wording\u00a0for')],
    ['oversized input', reflow + 'x'.repeat(131072)],
  ])('requires full CI for %s', (_name, changed) => {
    expect(classifyProse(narrative, changed).route).toBe('full');
  });

  it.each([
    'Clarified required review for readers.',
    'Updated security policy for readers.',
    'Clarified the `node command` for readers.',
    'Clarified [historical notes](https://example.invalid) for readers.',
    'Clarified <script>run()</script> for readers.',
    'Clarified **historical wording** for readers.',
    'Clarified historical | wording for readers.',
  ])('does not reflow unsupported or normative blocks: %s', (text) => {
    const before = narrative.replace('Clarified historical wording for readers.', text);
    expect(classifyProse(before, before.replace(' for readers', '\n  for readers')).route).toBe(
      'full',
    );
  });

  it('reads the complete real Git diff and file contents', () => {
    expect(classifyRepository(fixture()).route).toBe('prose');
    expect(classifyRepository(fixture(narrative.replace('Clarified', 'Changed'))).route).toBe(
      'full',
    );
  });

  it('rejects prose-looking content inside fenced, HTML or multiline code examples', () => {
    for (const [open, close] of [
      ['```text\n', '\n```'],
      ['<div>\n', '\n</div>'],
      ['``\n', '\n``'],
    ]) {
      const before = `${open}${narrative}${close}`;
      expect(classifyProse(before, before.replace('wording for', 'wording\n  for')).route).toBe(
        'full',
      );
    }
    const before = `${narrative}\n## Instructions\n\n- Clarified historical wording for readers.\n`;
    expect(
      classifyProse(
        before,
        before.replace(/wording for readers\.\n$/u, 'wording\n  for readers.\n'),
      ).route,
    ).toBe('full');
  });

  it('can reflow a supported entry in the real change-log context', () => {
    const source = readFileSync(prosePath, 'utf8').replace(/\r\n/gu, '\n');
    const supported = source.replace(
      '## Unreleased\n',
      '## Unreleased\n\n- Clarified historical wording for readers.\n',
    );
    expect(
      classifyProse(supported, supported.replace('wording for readers.', 'wording\n  for readers.'))
        .route,
    ).toBe('prose');
  });

  it.each([
    'AGENTS.md',
    'src/code.ts',
    '.github/workflows/ci.yml',
    'package.json',
    'pnpm-lock.yaml',
    'supabase/migrations/fixture.sql',
    'scripts/classify-ci-change.mjs',
    'other.md',
    'odd & name.md',
  ])('requires full CI for mixed changes including %s', (path) => {
    expect(classifyRepository(fixture(reflow, path)).route).toBe('full');
  });

  it.each(['rename', 'delete', 'mode'])('rejects %s changes', (operation) => {
    const state = fixture();
    if (operation === 'rename') runGit(state.cwd, ['mv', prosePath, `${prosePath}.renamed`]);
    if (operation === 'delete') runGit(state.cwd, ['rm', prosePath]);
    if (operation === 'mode') {
      runGit(state.cwd, ['config', 'core.filemode', 'false']);
      runGit(state.cwd, ['update-index', '--chmod=+x', prosePath]);
      runGit(state.cwd, [
        '-c',
        'user.name=Synthetic Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-m',
        'synthetic mode',
      ]);
    } else state.commit();
    state.head = runGit(state.cwd, ['rev-parse', 'HEAD']);
    state.checkout = state.head;
    expect(classifyRepository(state).route).toBe('full');
  });

  it('requires full CI for base drift and a different checked-out tree', () => {
    const state = fixture();
    expect(classifyRepository({ ...state, checkout: state.base }).route).toBe('full');
    expect(
      classifyRepository({ ...state, base: state.head, head: state.base, checkout: state.base })
        .route,
    ).toBe('full');
  });

  it('fails closed on missing history or malformed identities', () => {
    const state = fixture();
    expect(() => classifyRepository({ ...state, base: '0'.repeat(40) })).toThrow();
    expect(() => classifyRepository({ ...state, head: '--help' })).toThrow();
    expect(() => classifyRepository({ ...state, head: undefined })).toThrow();
  });

  it.each(['push', 'workflow_dispatch', 'merge_group', 'unknown'])(
    'always takes full CI for %s',
    (eventName) => {
      expect(classifyRepository({ eventName }).route).toBe('full');
    },
  );

  it('executes the CLI with exact comparison evidence and sanitizes errors', () => {
    const state = fixture();
    const eventPath = join(state.cwd, 'event.json');
    const output = join(state.cwd, 'output');
    const summary = join(state.cwd, 'summary');
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { base: { sha: state.base }, head: { sha: state.head } } }),
    );
    const env = {
      ...process.env,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_SHA: state.head,
      GITHUB_EVENT_NAME: 'pull_request',
    };
    const script = resolve('scripts/classify-ci-change.mjs');
    const result = spawnSync(process.execPath, [script], {
      cwd: state.cwd,
      env,
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('route=prose\n');
    expect(readFileSync(summary, 'utf8')).toContain(`base=${state.base}; head=${state.head}`);
    writeFileSync(eventPath, 'private synthetic invalid payload');
    const failed = spawnSync(process.execPath, [script], {
      cwd: state.cwd,
      env,
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('failed closed');
    expect(failed.stderr).not.toContain('private synthetic');
  });
});

describe('aggregate route truth table and workflow wiring', () => {
  it('accepts exactly the two complete selected-route outcomes', () => {
    const results = ['success', 'failure', 'cancelled', 'skipped', undefined];
    for (const route of ['full', 'prose', '', undefined]) {
      for (const classification of results)
        for (const application of results)
          for (const database of results)
            for (const prose of results) {
              const expected =
                classification === 'success' &&
                ((route === 'full' &&
                  application === 'success' &&
                  database === 'success' &&
                  prose === 'skipped') ||
                  (route === 'prose' &&
                    application === 'skipped' &&
                    database === 'skipped' &&
                    prose === 'success'));
              expect(qualityGate({ route, classification, application, database, prose })).toBe(
                expected,
              );
            }
    }
  });

  it('uses the tested gate in the real CLI and rejects missing results', () => {
    const script = resolve('scripts/classify-ci-change.mjs');
    for (const [route, application, database, prose] of [
      ['full', 'success', 'success', 'skipped'],
      ['prose', 'skipped', 'skipped', 'success'],
    ]) {
      const env = {
        ...process.env,
        GITHUB_STEP_SUMMARY: '',
        CLASSIFICATION_RESULT: 'success',
        CI_ROUTE: route,
        APPLICATION_RESULT: application,
        DATABASE_RESULT: database,
        PROSE_RESULT: prose,
      };
      expect(
        spawnSync(process.execPath, [script, '--gate'], { env, windowsHide: true }).status,
      ).toBe(0);
      expect(
        spawnSync(process.execPath, [script, '--gate'], {
          env: { ...env, CLASSIFICATION_RESULT: 'failure' },
          windowsHide: true,
        }).status,
      ).toBe(1);
    }
  });

  it('retains unfiltered triggers, stable names and fail-closed job selection', () => {
    expect(workflow).toContain(
      'on:\n  pull_request:\n  push:\n    branches:\n      - main\n  workflow_dispatch:',
    );
    expect(workflow).not.toMatch(/paths(?:-ignore)?:|pull_request_target:/u);
    for (const name of ['Application quality', 'Local Supabase security', 'Required quality gate'])
      expect(workflow).toContain(`name: ${name}`);
    expect(
      workflow.match(
        /if: \$\{\{ !cancelled\(\) && \(needs.classify.result != 'success' \|\| needs.classify.outputs.route != 'prose'\) \}\}/gu,
      ),
    ).toHaveLength(2);
    expect(workflow).toContain(
      "if: ${{ needs.classify.result == 'success' && needs.classify.outputs.route == 'prose' }}",
    );
    expect(workflow).toContain('run: node scripts/classify-ci-change.mjs');
    const gate = workflow.split('\n  quality-gate:')[1];
    expect(gate).toContain(
      'if: always()\n    needs:\n      - classify\n      - application\n      - database\n      - prose',
    );
    expect(gate).toContain('run: node scripts/classify-ci-change.mjs --gate');
    for (const source of [
      'classify.result',
      'classify.outputs.route',
      'application.result',
      'database.result',
      'prose.result',
    ])
      expect(gate).toContain(`\u0024{{ needs.${source} }}`);
    expect(gate).not.toContain('continue-on-error:');
  });

  it('keeps every prose verification step blocking', () => {
    const prose = workflow.split('\n  prose:')[1].split('\n  quality-gate:')[0];
    const steps = prose.split(/\n {6}- name:/u).slice(1);
    for (const command of [
      'node scripts/check-repository-secrets.mjs',
      'pnpm install --frozen-lockfile',
      'pnpm format:check',
      'pnpm check:docs',
      'pnpm exec vitest run scripts/lib/ci-gates.test.mjs',
    ]) {
      expect(
        steps.some(
          (step) =>
            step.match(/^ {8}run: (.+)$/mu)?.[1]?.trim() === command &&
            !/^ {8}(?:if|continue-on-error):/mu.test(step),
        ),
      ).toBe(true);
    }
  });
});
