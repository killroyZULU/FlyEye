import { readStagingBrowserConfiguration } from './feat-003-staging-browser-package.mjs';

// Pass these inline options to Vite's build() with the repository vite.config.ts.
// Feed only the browser field from the P1 configuration artifact.
export function stagingBrowserBuildOptions(browserText, selection) {
  const browser = readStagingBrowserConfiguration(browserText, selection);
  return {
    build: { write: false },
    envDir: false,
    envPrefix: [],
    define: Object.fromEntries(
      Object.entries(browser.frontendEnv).map(([name, value]) => [
        'import.meta.env.' + name,
        JSON.stringify(value),
      ]),
    ),
    plugins: [
      {
        name: 'flyeye-synthetic-staging',
        apply: 'build',
        transformIndexHtml() {
          return [
            { tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' } },
            { tag: 'aside', children: 'Synthetic staging', injectTo: 'body-prepend' },
          ];
        },
        generateBundle() {
          // A top-level 404 prevents Pages from treating every path as an SPA route.
          this.emitFile({
            type: 'asset',
            fileName: '404.html',
            source:
              '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Page unavailable</title><h1>Synthetic staging</h1><p>Page unavailable.</p><a href="/">Return to sign in</a></html>',
          });
          this.emitFile({
            type: 'asset',
            fileName: '_headers',
            source: '/*\n  X-Robots-Tag: noindex, nofollow\n',
          });
          if (browser.redirectUrls.length) {
            this.emitFile({
              type: 'asset',
              fileName: '_redirects',
              source: new URL(browser.redirectUrls[0]).pathname + ' /index.html 200\n',
            });
          }
        },
      },
    ],
  };
}
