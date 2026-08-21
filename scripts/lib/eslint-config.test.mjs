import path from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('ESLint configuration', () => {
  it('applies correctness rules to Edge Function entrypoints', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const [result] = await eslint.lintText('export const value = missingName;\n', {
      filePath: path.join(process.cwd(), 'supabase/functions/config-regression-fixture/index.ts'),
    });

    expect(result.messages.map((message) => message.ruleId)).toContain('no-undef');
  });

  it('does not permit browser-only globals in Deno Edge entrypoints', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const [result] = await eslint.lintText(
      'export const browserOnly = window.location.href + document.title;\n',
      {
        filePath: path.join(
          process.cwd(),
          'supabase/functions/config-browser-regression-fixture/index.ts',
        ),
      },
    );

    expect(
      result.messages
        .filter((message) => message.ruleId === 'no-undef')
        .map((message) => message.message),
    ).toEqual(["'window' is not defined.", "'document' is not defined."]);
  });
});
