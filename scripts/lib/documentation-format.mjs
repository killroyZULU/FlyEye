import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import * as prettier from 'prettier';

import { markdownFormatScope } from './repository-markdown.mjs';

export async function formatDocumentation(root, { write = false, baseline } = {}) {
  const scope = markdownFormatScope(root, baseline);
  const failures = [];
  const written = [];
  for (const name of scope.checked) {
    const filepath = resolve(root, name);
    const source = await readFile(filepath, 'utf8');
    const options = { ...(await prettier.resolveConfig(filepath)), filepath };
    const formatted = await prettier.format(source, options);
    if (source === formatted) continue;
    if (write) {
      await writeFile(filepath, formatted);
      written.push(name);
    } else {
      failures.push(name);
    }
  }
  return { ...scope, failures, written };
}
