import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const prosePath = 'docs/FlyEye_Documentation/16_CHANGE_LOG.md';
const shaPattern = /^[a-f0-9]{40}$/u;
const full = (reason) => ({ route: 'full', reason });

// This is intentionally a small grammar, not a Markdown or natural-language classifier.
// Only whitespace between unchanged words in plain retrospective bullets is eligible.
function normalizeNarrative(source) {
  if (source.length > 131072 || /[\r\t\0<>~]/u.test(source) || /^ *`{3,}/mu.test(source))
    return null;
  const lines = source.split('\n');
  // Do not mistake content inside a multiline inline-code span for prose.
  if (
    lines.some((line) => {
      const delimiters = line.match(/`+/gu) ?? [];
      return (
        delimiters.length % 2 !== 0 ||
        delimiters.some(
          (delimiter, index) => index % 2 === 1 && delimiter !== delimiters[index - 1],
        )
      );
    })
  )
    return null;
  const result = [];
  let retrospective = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^#/u.test(line)) retrospective = line === '## Unreleased';
    if (
      !retrospective ||
      !/^- (?:Added|Clarified|Consolidated|Corrected|Documented|Improved|Recorded|Updated) /u.test(
        line,
      )
    ) {
      result.push(line);
      continue;
    }
    const block = [line.slice(2)];
    while (/^ {2}[A-Za-z]/u.test(lines[index + 1] ?? '')) block.push(lines[++index].slice(2));
    const text = block.join(' ');
    const plain = block.every(
      (part) => /^[A-Za-z0-9 ,.;:'()!?%–—-]+$/u.test(part) && !/ $/u.test(part),
    );
    const normative =
      /\b(?:must|shall|should|required|require|requires|never|always|approval|authorize|authorized|permission|security|governance|policy)\b/iu.test(
        text,
      );
    result.push(
      plain && !normative
        ? `- ${text.replace(/ +/gu, ' ')}`
        : [line, ...block.slice(1).map((part) => `  ${part}`)].join('\n'),
    );
  }
  return result.join('\n');
}

export function classifyProse(before, after) {
  if (before === after) return full('empty-change');
  const normalized = normalizeNarrative(before);
  return normalized !== null && normalized === normalizeNarrative(after)
    ? { route: 'prose', reason: 'retrospective-whitespace-only' }
    : full('unsupported-or-semantic-change');
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1048576,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

export function classifyRepository({ eventName, base, head, checkout, cwd = process.cwd() }) {
  if (eventName !== 'pull_request') return full('event-requires-full');
  if (![base, head, checkout].every((sha) => typeof sha === 'string' && shaPattern.test(sha))) {
    throw new Error('Invalid comparison identity');
  }
  // Reject base drift and unexpected merge trees rather than evaluating an incomplete diff.
  const mergeBase = git(['merge-base', base, head], cwd).trim();
  if (mergeBase !== base) return full('base-not-ancestor');
  if (git(['rev-parse', `${checkout}^{tree}`], cwd) !== git(['rev-parse', `${head}^{tree}`], cwd)) {
    return full('checkout-tree-differs');
  }
  const changes = git(
    ['diff', '--no-ext-diff', '--no-renames', '--name-status', '-z', base, head, '--'],
    cwd,
  );
  if (changes !== `M\0${prosePath}\0`) return full('paths-or-status-require-full');
  for (const sha of [base, head]) {
    const entry = git(['ls-tree', sha, '--', prosePath], cwd);
    if (!/^100644 blob [a-f0-9]{40}\t/u.test(entry)) return full('unsupported-file-mode');
  }
  return classifyProse(
    git(['show', `${base}:${prosePath}`], cwd),
    git(['show', `${head}:${prosePath}`], cwd),
  );
}

export function qualityGate({ classification, route, application, database, prose }) {
  if (classification !== 'success') return false;
  if (route === 'full')
    return application === 'success' && database === 'success' && prose === 'skipped';
  if (route === 'prose')
    return prose === 'success' && application === 'skipped' && database === 'skipped';
  return false;
}

function main() {
  if (process.argv.includes('--gate')) {
    const state = {
      classification: process.env.CLASSIFICATION_RESULT,
      route: process.env.CI_ROUTE,
      application: process.env.APPLICATION_RESULT,
      database: process.env.DATABASE_RESULT,
      prose: process.env.PROSE_RESULT,
    };
    if (!qualityGate(state)) throw new Error('Required verification did not complete');
    const message =
      state.route === 'full'
        ? 'Full application and database verification passed.'
        : 'Prose checks passed. Application/database groups were not executed under the prose route.';
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
    return;
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const base = event.pull_request?.base?.sha;
  const head = event.pull_request?.head?.sha;
  const result = classifyRepository({
    eventName: process.env.GITHUB_EVENT_NAME,
    base,
    head,
    checkout: process.env.GITHUB_SHA,
  });
  appendFileSync(process.env.GITHUB_OUTPUT, `route=${result.route}\n`);
  const identity =
    process.env.GITHUB_EVENT_NAME === 'pull_request' ? `base=${base}; head=${head}; ` : '';
  const summary = `CI route: ${result.route}; reason=${result.reason}; ${identity}checkout=${process.env.GITHUB_SHA}\n`;
  console.log(summary.trim());
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch {
    // Do not leak diff contents, event payloads or child-process output in diagnostics.
    console.error('CI routing/gate failed closed. Required evidence is missing or invalid.');
    process.exitCode = 1;
  }
}
