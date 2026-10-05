import { describe, expect, it } from 'vitest';
import { analyzeBundle } from './bundle-budget.mjs';

const asset = (bytes) => ({ bytes, gzipBytes: bytes / 2 });

describe('production bundle budget', () => {
  it('counts transitive shared imports once and excludes deferred screens from initial bytes', () => {
    const manifest = {
      'index.html': {
        isEntry: true,
        file: 'entry.js',
        imports: ['shared', 'vendor'],
        dynamicImports: ['screen'],
      },
      shared: { file: 'shared.js', imports: ['vendor'] },
      vendor: { file: 'vendor.js' },
      screen: { file: 'screen.js' },
    };
    const assets = new Map([
      ['entry.js', asset(200_000)],
      ['shared.js', asset(100_000)],
      ['vendor.js', asset(100_000)],
      ['screen.js', asset(300_000)],
    ]);
    expect(analyzeBundle(manifest, assets)).toMatchObject({
      initialBytes: 400_000,
      initialGzipBytes: 200_000,
      chunks: 4,
    });
  });

  it('rejects a small entry hiding an oversized initial dependency total', () => {
    expect(() =>
      analyzeBundle(
        {
          'index.html': { isEntry: true, file: 'entry.js', imports: ['vendor'] },
          vendor: { file: 'vendor.js' },
        },
        new Map([
          ['entry.js', asset(100_000)],
          ['vendor.js', asset(460_000)],
        ]),
      ),
    ).toThrow('including static dependencies');
  });

  it('rejects an oversized deferred chunk', () => {
    expect(() =>
      analyzeBundle(
        { 'index.html': { isEntry: true, file: 'entry.js' } },
        new Map([
          ['entry.js', asset(50_000)],
          ['deferred.js', asset(500_001)],
        ]),
      ),
    ).toThrow('chunk exceeds');
  });

  it('fails closed for missing entry, manifest dependency or emitted asset', () => {
    expect(() => analyzeBundle({}, new Map())).toThrow('entry is missing');
    expect(() =>
      analyzeBundle(
        { 'index.html': { isEntry: true, file: 'entry.js', imports: ['missing'] } },
        new Map([['entry.js', asset(10)]]),
      ),
    ).toThrow('dependency is missing');
    expect(() =>
      analyzeBundle({ 'index.html': { isEntry: true, file: 'missing.js' } }, new Map()),
    ).toThrow('dependency is missing');
  });

  it('bounds cyclic static traversal without dropping shared bytes', () => {
    expect(
      analyzeBundle(
        {
          'index.html': { isEntry: true, file: 'entry.js', imports: ['shared'] },
          shared: { file: 'shared.js', imports: ['index.html'] },
        },
        new Map([
          ['entry.js', asset(100)],
          ['shared.js', asset(200)],
        ]),
      ),
    ).toMatchObject({ initialBytes: 300 });
  });
});
