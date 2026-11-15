// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');
const job = (name, source = workflow) =>
  source.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[a-z-]+:\n/)[0] ?? '';
const steps = (name, source) =>
  job(name, source)
    .split(/\n {6}- name: /)
    .slice(1);
const step = (name, title, source) =>
  steps(name, source).find((text) => text.startsWith(`${title}\n`)) ?? '';

function teardownBlocks(name, source = workflow) {
  const text = step(name, 'Stop local Supabase', source);
  return (
    text.includes('        if: always()\n') &&
    text.includes('        id: teardown\n') &&
    text.includes('        run: pnpm exec supabase stop --no-backup') &&
    !/continue-on-error:/.test(job(name, source)) &&
    job(name, source).includes('teardown: ${{ steps.teardown.outcome }}')
  );
}

describe('fresh mandatory stale runner contract', () => {
  it('keeps both runners independent and on identical pinned setup and migrations', () => {
    for (const name of ['database', 'stale']) {
      expect(job(name)).toContain('    needs: classify\n');
      expect(job(name)).toContain('    runs-on: ubuntu-latest\n');
      expect(job(name)).toContain('    timeout-minutes: 50\n');
      expect(job(name)).not.toMatch(
        /needs:.*(?:database|stale)|environment:|restore.*(?:volume|database)/i,
      );
      expect(steps(name).filter((x) => x.includes('run: pnpm test:runtime'))).toHaveLength(1);
      expect(step(name, 'Run sanitized local runtime matrix')).toContain(
        `run: pnpm test:runtime --partition=${name === 'database' ? 'core' : 'stale'}`,
      );
      expect(step(name, 'Run sanitized local runtime matrix')).not.toMatch(
        /if:|continue-on-error:/,
      );
    }
    for (const title of [
      'Check out repository',
      'Set up pnpm',
      'Set up Node.js',
      'Install frozen dependencies',
      'Install Playwright Chromium',
      'Configure synthetic local Edge Function origin',
      'Start local Supabase',
      'Reset local database from version-controlled migrations',
      'Verify migration types before runtime',
      'Lint local database',
      'Verify generated database types are current',
      'Stop local Supabase',
    ]) {
      const expected = step('database', title);
      expect(expected).not.toBe('');
      expect(step('stale', title)).toBe(expected);
    }
    expect(workflow).toContain('NODE_VERSION: 24.14.0');
    expect(workflow).toContain('PNPM_VERSION: 11.9.0');
    expect(step('stale', 'Install frozen dependencies')).toContain(
      'pnpm install --frozen-lockfile',
    );
    expect(step('stale', 'Install Playwright Chromium')).toContain(
      'pnpm exec playwright install --with-deps chromium',
    );
    expect(step('stale', 'Reset local database from version-controlled migrations')).toContain(
      'run: pnpm db:reset',
    );
    expect(step('stale', 'Verify migration types before runtime')).toContain('pnpm db:types:check');
    for (const title of [
      'Run SQL and RLS tests',
      'Verify A010 limiter concurrency and cleanup',
      'Verify H002 SQL lock interleaving',
      'Prepare pinned Linux no-send test CLI',
    ]) {
      expect(step('database', title)).not.toBe('');
      expect(step('database', title)).not.toMatch(/if:|continue-on-error:/);
      expect(step('stale', title)).toBe('');
    }
  });

  it.each(['database', 'stale'])(
    'requires final checks after runtime failure and blocking teardown in %s',
    (name) => {
      for (const title of ['Lint local database', 'Verify generated database types are current']) {
        expect(step(name, title)).toContain(
          "if: ${{ !cancelled() && steps.reset.outcome == 'success' }}",
        );
        expect(step(name, title)).not.toContain('continue-on-error:');
      }
      expect(teardownBlocks(name)).toBe(true);
      const original = step(name, 'Stop local Supabase');
      for (const replacement of [
        original.replace('if: always()', 'if: success()'),
        original.replace(
          '        id: teardown',
          '        continue-on-error: true\n        id: teardown',
        ),
        original.replace('pnpm exec supabase stop --no-backup', 'echo skipped'),
        original.replace('id: teardown', 'id: omitted'),
      ]) {
        const block = job(name);
        expect(
          teardownBlocks(name, workflow.replace(block, block.replace(original, replacement))),
        ).toBe(false);
      }
    },
  );
});
