// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { requireFeat003StagingDisabled } from './feat-003-staging-manifest.mjs';
import { validateFeat003StagingPreflight } from './feat-003-staging-preflight.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rejection = 'FEAT-003 staging preflight rejected.';
const disabled = JSON.parse(
  readFileSync(new URL('../../config/feat-003-staging-environment.json', import.meta.url), 'utf8'),
);

function fixture() {
  const manifest = {
    ...disabled,
    enabled: true,
    projectRef: 'abcdefghijklmnopqrst',
    apiOrigin: 'https://abcdefghijklmnopqrst.supabase.co',
    databaseHost: 'db.abcdefghijklmnopqrst.supabase.co',
    frontendOrigin: 'https://synthetic-preflight.pages.dev',
  };
  const contents = new Map(
    ['configuration', 'edge', 'frontend', 'lockfile', 'migrations'].map((name) => [
      name,
      Buffer.from(`Synthetic ${name} bytes; never a deployable package.`),
    ]),
  );
  const run = {
    schemaVersion: 1,
    environment: 'staging',
    dataClassification: 'synthetic-only',
    target: {
      cloudflareAccountId: '1'.repeat(32),
      supabaseOrganizationId: 'z'.repeat(20),
      pagesProjectId: 'synthetic-project-id',
      pagesProjectName: 'synthetic-preflight',
      supabaseProjectName: 'synthetic-preflight',
      region: 'ap-southeast-1',
      plan: 'free',
      monthlyCeilingUsd: 0,
      projectRef: manifest.projectRef,
      apiOrigin: manifest.apiOrigin,
      databaseHost: manifest.databaseHost,
      frontendOrigin: manifest.frontendOrigin,
    },
    sourceRevision: 'a'.repeat(40),
    manifestSha256: hash(JSON.stringify(manifest)),
    artifacts: [...contents].map(([name, bytes]) => ({ name, sha256: hash(bytes) })),
    operations: [
      'migrations',
      'configuration',
      'functions',
      'fixtures',
      'frontend',
      'checkpoint',
      'redeployment',
    ],
    approvals: {
      creation: 'synthetic-creation-approval',
      deployment: 'synthetic-deployment-approval',
    },
  };
  const review = {
    schemaVersion: 1,
    target: structuredClone(run.target),
    sourceRevision: run.sourceRevision,
    packageSha256: hash(JSON.stringify(run)),
    approvals: { ...run.approvals },
  };
  return { manifest, run, review, contents, checkoutRevision: run.sourceRevision };
}

function check(data) {
  return validateFeat003StagingPreflight(
    JSON.stringify(data.manifest),
    JSON.stringify(data.run),
    JSON.stringify(data.review),
    data.contents,
    data.checkoutRevision,
  );
}

// Block credential/environment access and global network access during each call,
// then restore the runner's own environment before using assertions.
function guardedCall(action) {
  const environment = Object.getOwnPropertyDescriptor(process, 'env');
  const forbidden = vi.fn(() => {
    throw new Error('Forbidden capability.');
  });
  const fetch = globalThis.fetch;
  let result;
  let error;
  try {
    Object.defineProperty(process, 'env', { configurable: true, get: forbidden });
    globalThis.fetch = forbidden;
    try {
      result = action();
    } catch (caught) {
      error = caught;
    }
  } finally {
    Object.defineProperty(process, 'env', environment);
    globalThis.fetch = fetch;
  }
  expect(forbidden).not.toHaveBeenCalled();
  return { result, error };
}

function rejects(data) {
  const { result, error } = guardedCall(() => check(data));
  expect(result).toBeUndefined();
  expect(error?.message).toBe(rejection);
}

describe('FEAT-003 P1 offline preflight', () => {
  it('reports consistency only, without granting execution or changing inputs', () => {
    const data = fixture();
    const before = JSON.stringify(data);
    const { result, error } = guardedCall(() => check(data));
    expect(error).toBeUndefined();
    expect(result).toEqual({ status: 'consistent', executionAuthorized: false });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(data)).toBe(before);
  });

  it('keeps the repository disabled and stops before inspecting later inputs', () => {
    expect(requireFeat003StagingDisabled(disabled)).toEqual({ enabled: false });
    expect(() => requireFeat003StagingDisabled(fixture().manifest)).toThrow();
    const access = vi.fn(() => {
      throw new Error('Later input accessed.');
    });
    const later = new Proxy({}, { get: access });
    const manifestText = JSON.stringify(disabled);
    const parse = vi.spyOn(JSON, 'parse');
    let outcome;
    let parsedInputs;
    try {
      outcome = guardedCall(() =>
        validateFeat003StagingPreflight(manifestText, '{}', '{}', later, later),
      );
      parsedInputs = [...parse.mock.calls];
    } finally {
      parse.mockRestore();
    }
    const { error } = outcome;
    expect(error?.message).toBe(rejection);
    expect(access).not.toHaveBeenCalled();
    expect(parsedInputs).toEqual([[manifestText]]);
    expect(disabled).toMatchObject({
      enabled: false,
      projectRef: null,
      apiOrigin: null,
      databaseHost: null,
      frontendOrigin: null,
    });
  });

  it('rejects a single approval reused across both gates even with all other bindings refreshed', () => {
    const data = fixture();
    data.run.approvals.deployment = data.run.approvals.creation;
    data.review.approvals = { ...data.run.approvals };
    data.review.packageSha256 = hash(JSON.stringify(data.run));
    rejects(data);
  });

  it('does not dispatch artifact-container or byte-array accessors', () => {
    const data = fixture();
    const access = vi.fn(() => {
      throw new Error('Supplied callback invoked.');
    });
    Object.defineProperty(data.contents, 'size', { get: access });
    Object.defineProperty(data.contents, 'get', { value: access });
    const bytes = Map.prototype.get.call(data.contents, 'edge');
    for (const key of ['byteLength', 'buffer', 'constructor', Symbol.toStringTag]) {
      Object.defineProperty(bytes, key, { get: access });
    }
    const { result, error } = guardedCall(() => check(data));
    expect(error).toBeUndefined();
    expect(result?.executionAuthorized).toBe(false);
    expect(access).not.toHaveBeenCalled();
  });

  it.each(['map', 'bytes'])('rejects a proxy %s without invoking traps', (kind) => {
    const data = fixture();
    const access = vi.fn(() => {
      throw new Error('Proxy trap invoked.');
    });
    const traps = { get: access, getPrototypeOf: access };
    if (kind === 'map') data.contents = new Proxy(data.contents, traps);
    else data.contents.set('edge', new Proxy(data.contents.get('edge'), traps));
    rejects(data);
    expect(access).not.toHaveBeenCalled();
  });

  it.each(['manifest', 'run', 'review'])('rejects every missing field in %s', (part) => {
    for (const key of Object.keys(fixture()[part])) {
      const data = fixture();
      delete data[part][key];
      rejects(data);
    }
  });

  it.each(['run', 'review'])(
    'rejects every missing or mismatched target identity in %s',
    (part) => {
      for (const key of Object.keys(fixture()[part].target)) {
        const missing = fixture();
        delete missing[part].target[key];
        rejects(missing);
        const changed = fixture();
        changed[part].target[key] =
          key === 'monthlyCeilingUsd' ? 1 : `different-${changed[part].target[key]}`;
        rejects(changed);
      }
    },
  );

  it('rejects a structurally valid other account even when the package digest is refreshed', () => {
    const data = fixture();
    data.run.target.cloudflareAccountId = '2'.repeat(32);
    data.review.packageSha256 = hash(JSON.stringify(data.run));
    rejects(data);
  });

  it.each([
    [
      'production',
      (d) => {
        d.run.environment = 'production';
      },
    ],
    [
      'real data',
      (d) => {
        d.run.dataClassification = 'real';
      },
    ],
    [
      'unsupported package version',
      (d) => {
        d.run.schemaVersion = 2;
      },
    ],
    [
      'unsupported review version',
      (d) => {
        d.review.schemaVersion = 2;
      },
    ],
    [
      'unknown package field',
      (d) => {
        d.run.credentials = 'DO-NOT-ECHO-SYNTHETIC';
      },
    ],
    [
      'unknown review field',
      (d) => {
        d.review.approved = true;
      },
    ],
    [
      'unknown target field',
      (d) => {
        d.run.target.secret = 'DO-NOT-ECHO-SYNTHETIC';
      },
    ],
    [
      'stale checkout',
      (d) => {
        d.checkoutRevision = 'b'.repeat(40);
      },
    ],
    [
      'short checkout',
      (d) => {
        d.checkoutRevision = 'abcdef0';
      },
    ],
    [
      'missing checkout',
      (d) => {
        d.checkoutRevision = undefined;
      },
    ],
    [
      'stale package revision',
      (d) => {
        d.run.sourceRevision = 'b'.repeat(40);
      },
    ],
    [
      'stale reviewed revision',
      (d) => {
        d.review.sourceRevision = 'b'.repeat(40);
      },
    ],
    [
      'manifest hash mismatch',
      (d) => {
        d.run.manifestSha256 = '0'.repeat(64);
      },
    ],
    [
      'invalid manifest hash',
      (d) => {
        d.run.manifestSha256 = null;
      },
    ],
    [
      'stale package hash',
      (d) => {
        d.review.packageSha256 = '0'.repeat(64);
      },
    ],
    [
      'invalid package hash',
      (d) => {
        d.review.packageSha256 = 'bad';
      },
    ],
    [
      'missing creation approval',
      (d) => {
        delete d.run.approvals.creation;
      },
    ],
    [
      'missing deployment approval',
      (d) => {
        delete d.run.approvals.deployment;
      },
    ],
    [
      'empty approval',
      (d) => {
        d.run.approvals.deployment = '';
      },
    ],
    [
      'same approval for both gates',
      (d) => {
        d.run.approvals.deployment = d.run.approvals.creation;
      },
    ],
    [
      'unreviewed approval',
      (d) => {
        d.review.approvals.deployment = 'another-approval';
      },
    ],
    [
      'missing reviewed approval',
      (d) => {
        delete d.review.approvals.creation;
      },
    ],
    [
      'extra approval field',
      (d) => {
        d.run.approvals.automatic = true;
      },
    ],
    [
      'extra reviewed approval field',
      (d) => {
        d.review.approvals.automatic = true;
      },
    ],
    [
      'missing operation',
      (d) => {
        d.run.operations.pop();
      },
    ],
    [
      'unknown operation',
      (d) => {
        d.run.operations[0] = 'delete-project';
      },
    ],
    [
      'reordered operations',
      (d) => {
        d.run.operations.reverse();
      },
    ],
    [
      'non-array operations',
      (d) => {
        d.run.operations = {};
      },
    ],
  ])('rejects %s without side effects or input disclosure', (_label, change) => {
    const data = fixture();
    change(data);
    rejects(data);
  });

  it.each([
    [
      'missing inventory entry',
      (d) => {
        d.run.artifacts.pop();
      },
    ],
    [
      'extra inventory entry',
      (d) => {
        d.run.artifacts.push(d.run.artifacts[0]);
      },
    ],
    [
      'duplicate inventory entry',
      (d) => {
        d.run.artifacts[1] = d.run.artifacts[0];
      },
    ],
    [
      'unknown artifact name',
      (d) => {
        d.run.artifacts[0].name = '../credential-file';
      },
    ],
    [
      'extra artifact field',
      (d) => {
        d.run.artifacts[0].path = '/secret';
      },
    ],
    [
      'missing digest',
      (d) => {
        delete d.run.artifacts[0].sha256;
      },
    ],
    [
      'malformed digest',
      (d) => {
        d.run.artifacts[0].sha256 = 1;
      },
    ],
    [
      'changed bytes',
      (d) => {
        d.contents.set('edge', Buffer.from('changed'));
      },
    ],
    [
      'empty bytes',
      (d) => {
        d.contents.set('edge', Buffer.alloc(0));
      },
    ],
    [
      'string instead of bytes',
      (d) => {
        d.contents.set('edge', 'text');
      },
    ],
    [
      'missing supplied artifact',
      (d) => {
        d.contents.delete('edge');
      },
    ],
    [
      'extra supplied artifact',
      (d) => {
        d.contents.set('unknown', Buffer.from('extra'));
      },
    ],
    [
      'substituted supplied name',
      (d) => {
        d.contents.delete('edge');
        d.contents.set('unknown', Buffer.from('extra'));
      },
    ],
    [
      'missing contents',
      (d) => {
        d.contents = undefined;
      },
    ],
    [
      'non-array inventory',
      (d) => {
        d.run.artifacts = {};
      },
    ],
  ])('rejects %s independently of package-digest validation', (_label, change) => {
    const data = fixture();
    change(data);
    data.review.packageSha256 = hash(JSON.stringify(data.run));
    rejects(data);
  });

  it('invalidates approval on a byte-only package or manifest change', () => {
    const d = fixture();
    for (const texts of [
      [JSON.stringify(d.manifest), `${JSON.stringify(d.run)}\n`],
      [`${JSON.stringify(d.manifest)}\n`, JSON.stringify(d.run)],
    ]) {
      const { error } = guardedCall(() =>
        validateFeat003StagingPreflight(
          ...texts,
          JSON.stringify(d.review),
          d.contents,
          d.checkoutRevision,
        ),
      );
      expect(error?.message).toBe(rejection);
    }
  });

  it.each(['', '{DO-NOT-ECHO-SYNTHETIC', 'null', '[]', 'true', '"text"', ' '.repeat(65537)])(
    'rejects malformed or oversized JSON: case %#',
    (text) => {
      const d = fixture();
      const inputs = [JSON.stringify(d.manifest), JSON.stringify(d.run), JSON.stringify(d.review)];
      for (let index = 0; index < 3; index++) {
        const changed = [...inputs];
        changed[index] = text;
        const { error } = guardedCall(() =>
          validateFeat003StagingPreflight(...changed, d.contents, d.checkoutRevision),
        );
        expect(error?.message).toBe(rejection);
      }
    },
  );

  it('keeps the complete validator dependency graph free of IO and execution capabilities', () => {
    const allowedImports = new Map([
      ['feat-003-staging-preflight.mjs', ['node:crypto', './feat-003-staging-manifest.mjs']],
      ['feat-003-staging-manifest.mjs', []],
    ]);
    const forbidden = new Set([
      'process',
      'fetch',
      'require',
      'global',
      'globalThis',
      'Deno',
      'eval',
      'Function',
      'WebSocket',
      'XMLHttpRequest',
      'Worker',
    ]);
    for (const [file, imports] of allowedImports) {
      const source = ts.createSourceFile(
        file,
        readFileSync(new URL(file, import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      );
      function visit(node) {
        if (ts.isImportDeclaration(node)) expect(imports).toContain(node.moduleSpecifier.text);
        if (ts.isCallExpression(node))
          expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword);
        if (ts.isIdentifier(node)) expect(forbidden.has(node.text)).toBe(false);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  });
});
