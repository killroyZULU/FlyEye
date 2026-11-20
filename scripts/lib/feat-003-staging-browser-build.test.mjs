// @vitest-environment node
import { build } from 'vite';
import { expect, it, vi } from 'vitest';
import { feat003StagingTarget } from '../../config/feat-003-staging-target.mjs';
import { stagingBrowserBuildOptions } from './feat-003-staging-browser-build.mjs';
import { generateStagingBrowserConfiguration } from './feat-003-staging-browser-package.mjs';

it.each([[], ['/auth/recovery']].map((callbackPaths) => ({ callbackPaths })))(
  'builds only the selected staging routes in memory: $callbackPaths',
  async ({ callbackPaths }) => {
    const selection = { publishableKey: 'sb_publishable_synthetic-build-key', callbackPaths };
    const text = generateStagingBrowserConfiguration(selection).toString('utf8');
    const options = stagingBrowserBuildOptions(text, selection);
    // Check before invoking Vite: a regression must never empty the normal dist.
    expect(options.build.write).toBe(false);
    vi.stubEnv('VITE_EXTRA_SYNTHETIC_CANARY', 'unexpected-build-environment-value');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'unexpected-key-override');
    try {
      const { output } = await build({ ...options, logLevel: 'silent' });
      const assets = new Map(output.map((entry) => [entry.fileName, entry.source]));
      const scripts = output
        .filter((entry) => entry.type === 'chunk')
        .map((chunk) => chunk.code)
        .join('\n');
      expect(scripts.includes(selection.publishableKey)).toBe(true);
      expect(scripts.includes(feat003StagingTarget.apiOrigin)).toBe(true);
      expect(scripts.includes('unexpected-build-environment-value')).toBe(false);
      expect(scripts.includes('unexpected-key-override')).toBe(false);
      expect(assets.get('index.html')).toContain('Synthetic staging');
      expect(assets.get('index.html')).toContain('noindex');
      expect(assets.get('_headers')).toContain('X-Robots-Tag: noindex');
      expect(assets.get('404.html')).toContain('Return to sign in');
      expect(assets.get('404.html')).not.toContain('<script');
      expect(assets.get('_redirects')).toBe(
        callbackPaths.length ? '/auth/recovery /index.html 200\n' : undefined,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  },
  30000,
);
