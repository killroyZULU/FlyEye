import { dirname, resolve } from 'node:path';

// Exclude Markdown examples from link/heading checks.
function proseLines(content) {
  let fence;
  return content
    .replace(/<!--[\s\S]*?-->/gu, '')
    .split(/\r?\n/u)
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          !marker[2].trim()
        ) {
          fence = undefined;
        }
        return '';
      }
      if (marker) {
        fence = marker[1];
        return '';
      }
      return line;
    });
}

export function markdownAnchors(content) {
  const anchors = new Set();
  for (const line of proseLines(content)) {
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line);
    if (!heading) continue;
    const base = heading[1]
      .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
      .replace(/<[^>]*>/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, '')
      .replaceAll(' ', '-');
    let anchor = base;
    for (let suffix = 1; anchors.has(anchor); suffix += 1) anchor = `${base}-${suffix}`;
    anchors.add(anchor);
  }
  return anchors;
}

// The repository uses ATX headings and inline links, not a general Markdown renderer.
export function validateMarkdownLinks(contents, exists) {
  const failures = [];
  const anchors = new Map([...contents].map(([file, content]) => [file, markdownAnchors(content)]));
  for (const [file, content] of contents) {
    const prose = proseLines(content)
      .join('\n')
      .replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/gu, '');
    for (const match of prose.matchAll(
      /\[[^\]]*\]\((<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/gu,
    )) {
      const raw = match[1].replace(/^<|>$/gu, '');
      if (!raw || /^[a-z][a-z0-9+.-]*:/iu.test(raw) || raw.startsWith('//')) continue;
      try {
        const separator = raw.indexOf('#');
        const path = separator < 0 ? raw : raw.slice(0, separator);
        const fragment = separator < 0 ? '' : decodeURIComponent(raw.slice(separator + 1));
        const target = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
        if (!exists(target)) {
          failures.push({ file, message: `links to missing path: ${raw}` });
        } else if (fragment && anchors.has(target) && !anchors.get(target).has(fragment)) {
          failures.push({ file, message: `links to missing Markdown section: ${raw}` });
        }
      } catch {
        failures.push({ file, message: `has an invalid encoded link: ${raw}` });
      }
    }
  }
  return failures;
}
