// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

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
