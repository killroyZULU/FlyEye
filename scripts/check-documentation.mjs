import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import { validateMarkdownLinks } from './lib/markdown-links.mjs';

const root = process.cwd();
const failures = [];
const excludedDirectories = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) {
      return [];
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return walk(path);
    }
    return entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? [path] : [];
  });
}

function words(text) {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function display(path) {
  return relative(root, path).replaceAll('\\', '/');
}

function validateFeatureStructure(name, content, targetFailures) {
  const match = name.match(/^docs\/FlyEye_Documentation\/features\/(FEAT-\d{3})_[A-Z0-9_]+\.md$/u);
  if (!match) {
    targetFailures.push(`${name} does not follow the FEAT-XXX_UPPER_SNAKE_CASE.md convention.`);
    return undefined;
  }

  const featureId = match[1];
  const firstHeading = content.match(/^# .+$/mu)?.[0] ?? '';
  const filename = basename(name);
  const supportSuffixes = [
    '_LOCAL_SECURITY_TESTING.md',
    '_HOSTED_SYNTHETIC_HARDENING.md',
    '_QUALIFIED_HUMAN_REVIEW_PACKAGE.md',
  ];

  if (filename.endsWith('_TRACEABILITY.md')) {
    const traceHeading = new RegExp(`^# ${featureId} (?:Requirements )?Traceability$`, 'u');
    if (!traceHeading.test(firstHeading)) {
      targetFailures.push(`${name} must start with a ${featureId} traceability heading.`);
    }
    return 2500;
  }

  if (supportSuffixes.some((suffix) => filename.endsWith(suffix))) {
    if (!firstHeading.includes(featureId)) {
      targetFailures.push(`${name} first heading must contain ${featureId}.`);
    }
    return 2500;
  }

  if (!firstHeading.startsWith(`# Feature Specification: ${featureId} `)) {
    targetFailures.push(`${name} must start with the required ${featureId} feature heading.`);
  }
  return 4000;
}

function runSelfTests() {
  const fixtureDirectory = resolve(root, 'scripts/fixtures/documentation');
  const valid = readFileSync(join(fixtureDirectory, 'valid-feature-heading.txt'), 'utf8');
  const invalid = readFileSync(join(fixtureDirectory, 'invalid-feature-heading.txt'), 'utf8');
  const validFailures = [];
  const invalidFailures = [];

  validateFeatureStructure(
    'docs/FlyEye_Documentation/features/FEAT-099_VALID_FIXTURE.md',
    valid,
    validFailures,
  );
  validateFeatureStructure(
    'docs/FlyEye_Documentation/features/FEAT-099_INVALID_FIXTURE.md',
    invalid,
    invalidFailures,
  );

  if (validFailures.length !== 0 || invalidFailures.length === 0) {
    failures.push('Documentation checker feature-structure self-test failed.');
  }
}

runSelfTests();

const markdownFiles = walk(root);
const contents = new Map(markdownFiles.map((path) => [path, readFileSync(path, 'utf8')]));
const exactBudgets = new Map([
  ['AGENTS.md', 1600],
  ['docs/FlyEye_Documentation/README.md', 900],
  ['docs/FlyEye_Documentation/CURRENT_STATE.md', 900],
  ['docs/FlyEye_Documentation/01_MASTER_HANDOFF.md', 1500],
  ['docs/FlyEye_Documentation/09_AI_DEVELOPMENT_GUIDE.md', 1600],
  ['docs/FlyEye_Documentation/16_CHANGE_LOG.md', 1200],
  ['docs/FlyEye_Documentation/17_PRODUCT_AND_GOVERNANCE_DECISIONS.md', 2000],
]);

for (const [path, content] of contents) {
  const name = display(path);
  let budget = exactBudgets.get(name);
  if (name.startsWith('docs/FlyEye_Documentation/features/')) {
    budget = validateFeatureStructure(name, content, failures);
  }
  if (budget && words(content) > budget) {
    failures.push(`${name} has ${words(content)} words; budget is ${budget}.`);
  }
}

for (const failure of validateMarkdownLinks(contents, existsSync)) {
  failures.push(`${display(failure.file)} ${failure.message}`);
}

const requiredEntryPoints = [
  'AGENTS.md',
  'docs/FlyEye_Documentation/README.md',
  'docs/FlyEye_Documentation/CURRENT_STATE.md',
  'docs/FlyEye_Documentation/01_MASTER_HANDOFF.md',
  'docs/FlyEye_Documentation/09_AI_DEVELOPMENT_GUIDE.md',
  'docs/FlyEye_Documentation/17_PRODUCT_AND_GOVERNANCE_DECISIONS.md',
];
for (const name of requiredEntryPoints) {
  if (!contents.has(resolve(root, name))) {
    failures.push(`Missing required active document: ${name}`);
  }
}

const seenParagraphs = new Map();
for (const [path, content] of contents) {
  const name = display(path);
  for (const paragraph of content.split(/\r?\n\s*\r?\n/gu)) {
    if (words(paragraph) < 40 || paragraph.startsWith('```') || paragraph.includes('|---')) {
      continue;
    }
    const normalizedParagraph = paragraph.replace(/\s+/gu, ' ').trim().toLowerCase();
    const previous = seenParagraphs.get(normalizedParagraph);
    if (previous) {
      failures.push(`Duplicate long paragraph in ${previous} and ${name}.`);
    } else {
      seenParagraphs.set(normalizedParagraph, name);
    }
  }
}

const prohibitedActiveHeadings =
  /^#{1,6}\s+.*(?:historical .*model|prompt for another|copy-ready authorization)/gimu;
for (const name of requiredEntryPoints) {
  const content = contents.get(resolve(root, name)) ?? '';
  if (prohibitedActiveHeadings.test(content)) {
    failures.push(`${name} contains a prohibited historical/prompt heading.`);
  }
  prohibitedActiveHeadings.lastIndex = 0;
}

for (const [path, content] of contents) {
  if (!/^# Feature Specification:/mu.test(content)) {
    continue;
  }
  const prohibitedFeatureHeadings =
    /^#{1,6}\s+.*(?:approval chronology|authorization boundary|implementation diary|prompt transcript)/gimu;
  if (prohibitedFeatureHeadings.test(content)) {
    failures.push(
      `${display(path)} mixes history or authorization boilerplate into the feature contract.`,
    );
  }
}

if (failures.length > 0) {
  console.error('Documentation checks failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

const totalWords = [...contents.values()].reduce((sum, content) => sum + words(content), 0);
console.log(
  `Documentation checks passed: ${contents.size} repository Markdown files, ${totalWords} words, valid local links, budgets, feature structure, self-tests, and duplicate-long-paragraph checks.`,
);
