import { describe, expect, it } from 'vitest';

import { analyzeCodeMaintainability } from './code-maintainability.mjs';

const analyze = (files, options = {}) =>
  analyzeCodeMaintainability(new Map(Object.entries(files)), {
    legacyCrossFeatureImports: [],
    legacyFileLineLimits: {},
    legacyLayerImports: [],
    ...options,
  });

describe('code maintainability analysis', () => {
  it('permits feature imports through a public entry point', () => {
    const result = analyze({
      'src/features/aircraft/index.ts': "export { aircraftSchema } from './schema';",
      'src/features/aircraft/schema.ts': 'export const aircraftSchema = {};',
      'src/features/dispatch/draft.ts':
        "import { aircraftSchema } from '../aircraft';\nexport const draft = aircraftSchema;",
    });

    expect(result.errors).toEqual([]);
  });

  it('rejects imports of another feature internal file', () => {
    const result = analyze({
      'src/features/aircraft/schema.ts': 'export const aircraftSchema = {};',
      'src/features/dispatch/draft.ts':
        "import { aircraftSchema } from '../aircraft/schema';\nexport const draft = aircraftSchema;",
    });

    expect(result.errors).toContain(
      'src/features/dispatch/draft.ts -> src/features/aircraft/schema.ts bypasses the aircraft feature public entry point.',
    );
  });

  it('rejects cross-Edge-Function internal imports outside _shared', () => {
    const result = analyze({
      'supabase/functions/aircraft/handler.ts': 'export const handler = true;',
      'supabase/functions/dispatch/handler.ts':
        "import { handler } from '../aircraft/handler.ts';\nexport const dispatch = handler;",
    });

    expect(result.errors[0]).toContain('crosses Edge Function internals');
  });

  it('rejects frontend and Edge Function layer crossings', () => {
    const result = analyze({
      'src/features/dispatch/client.ts':
        "import { handler } from '../../../supabase/functions/dispatch/handler.ts';\nexport const client = handler;",
      'supabase/functions/dispatch/handler.ts': 'export const handler = true;',
      'supabase/functions/dispatch/ui.ts':
        "import { view } from '../../../src/features/dispatch/view.ts';\nexport const edgeView = view;",
      'src/features/dispatch/view.ts': 'export const view = true;',
    });

    expect(result.errors).toContain(
      'src/features/dispatch/client.ts -> supabase/functions/dispatch/handler.ts crosses the frontend and Edge Function source layers.',
    );
    expect(result.errors).toContain(
      'supabase/functions/dispatch/ui.ts -> src/features/dispatch/view.ts crosses the frontend and Edge Function source layers.',
    );
  });

  it('rejects a shared-library proxy to feature internals', () => {
    const result = analyze({
      'src/features/aircraft/internal.ts': 'export const internal = true;',
      'src/lib/aircraft-proxy.ts': "export { internal } from '../features/aircraft/internal';",
    });

    expect(result.errors).toContain(
      'src/lib/aircraft-proxy.ts -> src/features/aircraft/internal.ts makes shared library code depend on feature internals.',
    );
  });

  it('detects circular production imports', () => {
    const result = analyze({
      'src/lib/a.ts': "import './b';",
      'src/lib/b.ts': "import './a';",
    });

    expect(result.errors).toContain(
      'Circular production import: src/lib/a.ts -> src/lib/b.ts -> src/lib/a.ts.',
    );
  });

  it('rejects an oversized new file and growth above a legacy ceiling', () => {
    const oversized = 'export const value = true;\n'.repeat(5);
    const result = analyze(
      {
        'src/lib/legacy.ts': oversized,
        'src/lib/new.ts': oversized,
      },
      {
        defaultMaxFileLines: 4,
        legacyFileLineLimits: { 'src/lib/legacy.ts': 5 },
      },
    );

    expect(result.errors).toEqual([
      'src/lib/legacy.ts has 6 lines (legacy ceiling 5).',
      'src/lib/new.ts has 6 lines (default ceiling 4).',
    ]);
  });

  it('applies a smaller ceiling to Edge Function entrypoints', () => {
    const oversized = 'const value = true;\n'.repeat(5);
    const result = analyze(
      { 'supabase/functions/dispatch/index.ts': oversized },
      { defaultMaxEdgeEntrypointLines: 4, defaultMaxFileLines: 10 },
    );

    expect(result.errors).toContain(
      'supabase/functions/dispatch/index.ts has 6 lines (Edge entrypoint ceiling 4).',
    );
  });
});
