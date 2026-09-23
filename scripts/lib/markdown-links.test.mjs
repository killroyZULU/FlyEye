import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { markdownAnchors, validateMarkdownLinks } from './markdown-links.mjs';

function check(source, target = '# Target\n\n## Existing section') {
  const sourcePath = resolve('docs/source.md');
  const targetPath = resolve('docs/target.md');
  const contents = new Map([
    [sourcePath, source],
    [targetPath, target],
  ]);
  return validateMarkdownLinks(contents, (path) => contents.has(path));
}

describe('local Markdown links', () => {
  it('rejects nonexistent sections even when the document exists', () => {
    expect(check('[broken](target.md#removed-section)')[0].message).toBe(
      'links to missing Markdown section: target.md#removed-section',
    );
    expect(check('# Source\n[broken](#removed-section)')[0].message).toContain(
      'missing Markdown section',
    );
  });

  it('accepts same-file and cross-file headings, encoded fragments, and titled links', () => {
    expect(
      check('# Source\n[local](#source) [target](target.md#existing%2Dsection "Details")'),
    ).toEqual([]);
  });

  it('preserves missing-file and malformed-encoding failures', () => {
    expect(check('[broken](absent.md#section)')[0].message).toContain('missing path');
    expect(check('[broken](target.md#%zz)')[0].message).toContain('invalid encoded link');
    expect(check('[broken](%zz.md)')[0].message).toContain('invalid encoded link');
  });

  it.each(['"title"', "'title'", '(title)'])(
    'checks missing paths and sections with a %s title',
    (title) => {
      expect(check(`[broken](missing.md ${title})`)[0].message).toContain('missing path');
      expect(check(`[broken](#removed ${title})`)[0].message).toContain('missing Markdown section');
      expect(check(`[valid](target.md#existing-section ${title})`)).toEqual([]);
    },
  );

  it('keeps prose links between code spans containing shorter backtick runs', () => {
    expect(check('``a`b`` [broken](missing.md) `c`')[0].message).toContain('missing path');
    expect(check('``a`b`` [broken](#removed) `c`')[0].message).toContain(
      'missing Markdown section',
    );
    expect(check('``a`b [example](missing.md)`` `c`')).toEqual([]);
  });

  it('does not treat external or non-Markdown fragments as Markdown headings', () => {
    const file = resolve('source.md');
    const contents = new Map([
      [file, '[web](https://example.com/#section) [pdf](report.pdf#page=2) [root](//example.com/)'],
    ]);
    expect(validateMarkdownLinks(contents, () => true)).toEqual([]);
  });

  it('handles angle-bracket paths with encoded spaces', () => {
    const source = resolve('source.md');
    const target = resolve('My Document.md');
    const contents = new Map([
      [source, '[target](<My%20Document.md#heading>)'],
      [target, '# Heading'],
    ]);
    expect(validateMarkdownLinks(contents, (path) => contents.has(path))).toEqual([]);
  });

  it('ignores links and headings in fenced examples, comments and inline code', () => {
    expect(
      check(
        '```md\n# Fake\n[missing](absent.md)\n```\n`[missing](absent.md)`\n<!-- [missing](absent.md) -->',
      ),
    ).toEqual([]);
    expect(check('~~~md\n# Fake\n~~~\n[missing](#fake)')[0].message).toContain(
      'missing Markdown section',
    );
  });
});

describe('repository Markdown heading anchors', () => {
  it('normalizes formatted headings and retains Unicode letters', () => {
    expect([
      ...markdownAnchors('# **Café** and `code` / [link](https://example.com)\n## 1. Scope'),
    ]).toEqual(['café-and-code--link', '1-scope']);
  });

  it('assigns distinct anchors to repeated headings and suffix collisions', () => {
    expect([...markdownAnchors('# Repeat\n## Repeat\n## Repeat-1\n## Repeat')]).toEqual([
      'repeat',
      'repeat-1',
      'repeat-1-1',
      'repeat-2',
    ]);
  });

  it('requires a matching fence character and length before accepting headings', () => {
    expect([...markdownAnchors('````md\n```\n# Fake\n~~~\n# Fake too\n````\n# Real')]).toEqual([
      'real',
    ]);
  });
});
