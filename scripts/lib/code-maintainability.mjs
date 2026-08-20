import fs from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';

export const DEFAULT_MAX_FILE_LINES = 400;
export const DEFAULT_MAX_EDGE_ENTRYPOINT_LINES = 250;

export const LEGACY_FILE_LINE_LIMITS = Object.freeze({
  'src/features/auth/AuthApp.tsx': 628,
  'src/features/auth/components/AdminOnboardingFlow.tsx': 334,
  'src/features/auth/components/MemberInvitationsPanel.tsx': 282,
  'src/features/auth/components/MemberMfaEnrollmentFlow.tsx': 495,
  'src/features/auth/components/PasswordRecoveryFlow.tsx': 325,
  'src/features/auth/services/auth-gateway.ts': 1630,
  'src/features/members/components/MemberAdministrationPanel.tsx': 627,
  'src/features/members/components/MemberProfilePanel.tsx': 242,
  'supabase/functions/auth-bootstrap/handler.ts': 365,
  'supabase/functions/member-administration/handler.ts': 952,
  'supabase/functions/member-invitations/handler.ts': 703,
  'supabase/functions/member-mfa/handler.ts': 566,
  'supabase/functions/organization-admin-onboarding/handler.ts': 642,
});

export const LEGACY_CROSS_FEATURE_IMPORTS = Object.freeze([
  'src/features/auth/AuthApp.tsx -> src/features/members/components/MemberAdministrationPanel.tsx',
  'src/features/auth/AuthApp.tsx -> src/features/members/components/MemberProfilePanel.tsx',
  'src/features/members/components/MemberAdministrationPanel.tsx -> src/features/auth/services/auth-gateway.ts',
  'src/features/members/components/MemberProfilePanel.tsx -> src/features/auth/services/auth-gateway.ts',
  'src/features/auth/services/auth-gateway.ts -> src/features/members/member-administration.ts',
]);

export const LEGACY_LAYER_IMPORTS = Object.freeze([
  'src/lib/access-context.ts -> supabase/functions/_shared/access-context.ts',
  'src/lib/supabase.ts -> src/features/auth/services/auth-gateway.ts',
]);

const SOURCE_ROOTS = ['src', 'supabase/functions'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function isProductionTypeScript(relativePath) {
  const normalized = toPosix(relativePath);
  return (
    SOURCE_EXTENSIONS.some((extension) => normalized.endsWith(extension)) &&
    !normalized.endsWith('.d.ts') &&
    !normalized.includes('.test.') &&
    !normalized.includes('.spec.') &&
    !normalized.startsWith('src/test/') &&
    normalized !== 'src/lib/database.types.ts'
  );
}

async function collectFiles(root, relativeDirectory, result) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = toPosix(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) {
      await collectFiles(root, relativePath, result);
    } else if (entry.isFile() && isProductionTypeScript(relativePath)) {
      result.set(relativePath, await fs.readFile(path.join(root, relativePath), 'utf8'));
    }
  }
}

function importSpecifiers(source, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers = [];

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

function resolveRelativeImport(sourcePath, specifier, files) {
  if (!specifier.startsWith('.')) {
    return undefined;
  }

  const sourceDirectory = path.posix.dirname(sourcePath);
  const rawTarget = path.posix.normalize(path.posix.join(sourceDirectory, specifier));
  const withoutJavaScriptExtension = rawTarget.replace(/\.(?:m?js|jsx)$/u, '');
  const candidates = [
    rawTarget,
    `${rawTarget}.ts`,
    `${rawTarget}.tsx`,
    `${withoutJavaScriptExtension}.ts`,
    `${withoutJavaScriptExtension}.tsx`,
    `${rawTarget}/index.ts`,
    `${rawTarget}/index.tsx`,
  ];

  return candidates.find((candidate) => files.has(candidate));
}

function featureName(filePath) {
  return /^src\/features\/([^/]+)\//u.exec(filePath)?.[1];
}

function edgeFunctionName(filePath) {
  return /^supabase\/functions\/([^/]+)\//u.exec(filePath)?.[1];
}

function isEdgeEntrypoint(filePath) {
  return /^supabase\/functions\/[^/]+\/index\.ts$/u.test(filePath);
}

function isPublicFeatureEntry(targetPath, targetFeature) {
  return (
    targetPath === `src/features/${targetFeature}/index.ts` ||
    targetPath === `src/features/${targetFeature}/index.tsx`
  );
}

function findCycles(graph) {
  const cycles = new Set();
  const visited = new Set();
  const active = new Set();
  const stack = [];

  const visit = (node) => {
    if (active.has(node)) {
      const cycleStart = stack.indexOf(node);
      cycles.add([...stack.slice(cycleStart), node].join(' -> '));
      return;
    }
    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    active.add(node);
    stack.push(node);
    for (const target of [...(graph.get(node) ?? [])].sort()) {
      visit(target);
    }
    stack.pop();
    active.delete(node);
  };

  for (const node of [...graph.keys()].sort()) {
    visit(node);
  }
  return [...cycles].sort();
}

export function analyzeCodeMaintainability(
  sourceFiles,
  {
    defaultMaxFileLines = DEFAULT_MAX_FILE_LINES,
    defaultMaxEdgeEntrypointLines = DEFAULT_MAX_EDGE_ENTRYPOINT_LINES,
    legacyFileLineLimits = LEGACY_FILE_LINE_LIMITS,
    legacyCrossFeatureImports = LEGACY_CROSS_FEATURE_IMPORTS,
    legacyLayerImports = LEGACY_LAYER_IMPORTS,
  } = {},
) {
  const files = new Map(
    [...sourceFiles.entries()].map(([fileName, source]) => [toPosix(fileName), source]),
  );
  const errors = [];
  const graph = new Map();
  const allowedLegacyImports = new Set(legacyCrossFeatureImports);
  const allowedLegacyLayerImports = new Set(legacyLayerImports);

  for (const [fileName, source] of [...files.entries()].sort()) {
    const lineCount = source.split(/\r?\n/u).length;
    const defaultLineLimit = isEdgeEntrypoint(fileName)
      ? defaultMaxEdgeEntrypointLines
      : defaultMaxFileLines;
    const lineLimit = legacyFileLineLimits[fileName] ?? defaultLineLimit;
    if (lineCount > lineLimit) {
      const legacyContext = legacyFileLineLimits[fileName]
        ? `legacy ceiling ${lineLimit}`
        : isEdgeEntrypoint(fileName)
          ? `Edge entrypoint ceiling ${defaultMaxEdgeEntrypointLines}`
          : `default ceiling ${defaultMaxFileLines}`;
      errors.push(`${fileName} has ${lineCount} lines (${legacyContext}).`);
    }

    const targets = new Set();
    for (const specifier of importSpecifiers(source, fileName)) {
      const target = resolveRelativeImport(fileName, specifier, files);
      if (!target) {
        continue;
      }
      targets.add(target);
      const importKey = `${fileName} -> ${target}`;

      const sourceFeature = featureName(fileName);
      const targetFeature = featureName(target);
      if (sourceFeature && targetFeature && sourceFeature !== targetFeature) {
        if (!isPublicFeatureEntry(target, targetFeature) && !allowedLegacyImports.has(importKey)) {
          errors.push(`${importKey} bypasses the ${targetFeature} feature public entry point.`);
        }
      }

      const sourceFunction = edgeFunctionName(fileName);
      const targetFunction = edgeFunctionName(target);
      if (
        sourceFunction &&
        targetFunction &&
        sourceFunction !== targetFunction &&
        targetFunction !== '_shared'
      ) {
        errors.push(
          `${fileName} -> ${target} crosses Edge Function internals; use _shared or a reviewed command boundary.`,
        );
      }

      const sourceIsFrontend = fileName.startsWith('src/');
      const targetIsFrontend = target.startsWith('src/');
      const sourceIsEdge = fileName.startsWith('supabase/functions/');
      const targetIsEdge = target.startsWith('supabase/functions/');
      if (
        ((sourceIsFrontend && targetIsEdge) || (sourceIsEdge && targetIsFrontend)) &&
        !allowedLegacyLayerImports.has(importKey)
      ) {
        errors.push(`${importKey} crosses the frontend and Edge Function source layers.`);
      }

      if (
        fileName.startsWith('src/lib/') &&
        target.startsWith('src/features/') &&
        !allowedLegacyLayerImports.has(importKey)
      ) {
        errors.push(`${importKey} makes shared library code depend on feature internals.`);
      }
    }
    graph.set(fileName, targets);
  }

  for (const cycle of findCycles(graph)) {
    errors.push(`Circular production import: ${cycle}.`);
  }

  return {
    errors: [...new Set(errors)].sort(),
    fileCount: files.size,
  };
}

export async function analyzeRepository(root) {
  const sourceFiles = new Map();
  for (const sourceRoot of SOURCE_ROOTS) {
    await collectFiles(root, sourceRoot, sourceFiles);
  }
  return analyzeCodeMaintainability(sourceFiles);
}
