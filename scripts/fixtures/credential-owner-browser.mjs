import assert from 'node:assert/strict';
import { mountFailure } from './credential-mount-result.mjs';
import { requireStatus } from './credential-checkpoint-log.mjs';
import { openCheckpointPage } from './credential-checkpoint-page.mjs';
import { randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { syntheticSample } from '../../src/features/credentials/owner-gateway.ts';

export const browserOptions = {
  headless: true,
  channel: process.platform === 'win32' ? 'msedge' : undefined,
};
export async function buildBrowserBundle(checkpoint = false) {
  const built = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': '"production"',
      ...(checkpoint
        ? {
            'import.meta.env.DEV': 'true',
            'import.meta.env.VITE_SUPABASE_URL': '"http://127.0.0.1:58321"',
          }
        : {}),
    },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: checkpoint
          ? 'scripts/fixtures/credential-chromium-entry.tsx'
          : 'scripts/fixtures/credential-owner-browser-entry.tsx',
        name: 'Proof',
        formats: ['iife'],
      },
    },
  });
  return (Array.isArray(built) ? built : [built])
    .flatMap((r) => r.output)
    .find((o) => o.type === 'chunk' && o.isEntry).code;
}
export async function prepareBrowser(checkpoint = false) {
  const bundle = await buildBrowserBundle(checkpoint);
  const browser = await chromium.launch(browserOptions);
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundle });
    assert.equal(await page.evaluate(() => typeof globalThis.Proof.mount), 'function');
  } finally {
    await browser.close();
  }
  return bundle;
}
export async function proveOwnerBrowser({
  status,
  school,
  member,
  origin,
  invoke,
  session,
  login,
  replacementProof,
  categoryProof,
  bundle,
  mark,
}) {
  const config = {
    ALLOWED_ORIGIN: origin,
    SUPABASE_URL: status.API_URL,
    SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    FLYEYE_RUNTIME_PROFILE: 'local-synthetic-v1',
    FEAT005_LIMITER_POLICY_VERSION: 'member-administration-subject-scope-v1',
    FEAT005_DATA_CLASSIFICATION: 'synthetic-only',
    FEAT005_LIMITER_HMAC_SECRET: randomBytes(40).toString('hex'),
  };
  let metadata;
  mark('load-metadata-handler');
  const prior = globalThis.Deno;
  try {
    globalThis.Deno = {
      env: { get: (k) => config[k] },
      serve: (fn) => {
        metadata = fn;
      },
    };
    await import('../../supabase/functions/member-administration/index.ts');
  } finally {
    if (prior === undefined) delete globalThis.Deno;
    else globalThis.Deno = prior;
  }
  assert.equal(typeof metadata, 'function');
  mark('launch-browser');
  const browser = await chromium.launch(browserOptions);
  let checkpointPage;
  try {
    if (login) {
      mark('bind-loopback-page');
      checkpointPage = await openCheckpointPage(origin);
    }
    const page = await browser.newPage({ serviceWorkers: 'block' });
    const seen = [];
    let operation;
    await page.route('**/*', async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (checkpointPage && url.origin === origin)
        return req.method() === 'GET' && req.url() === origin + '/'
          ? route.continue()
          : route.abort();
      if (url.origin === origin && url.pathname === '/')
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><div id="root"></div>',
        });
      if (url.origin === status.API_URL && url.pathname.startsWith('/auth/v1/'))
        return route.continue();
      if (
        url.origin !== status.API_URL ||
        !['/functions/v1/member-administration', '/functions/v1/credential-owner'].includes(
          url.pathname,
        )
      )
        return route.abort();
      const handler = url.pathname.endsWith('/credential-owner') ? invoke : metadata;
      const request = new Request(req.url(), {
        method: req.method(),
        headers: await req.allHeaders(),
        body: req.postDataBuffer() ?? undefined,
      });
      const result = await handler(request);
      if (
        replacementProof &&
        handler === invoke &&
        req.method() === 'POST' &&
        replacementProof.dropAcknowledgement(req.postDataJSON(), request, result)
      ) {
        return route.fulfill({
          status: 503,
          headers: Object.fromEntries(result.headers),
          body: 'null',
        });
      }
      seen.push(result.status);
      mark((handler === invoke ? 'owner' : 'metadata') + '-http-' + result.status);
      if (!login && handler === invoke && result.status === 201 && !operation) {
        operation = req.postDataJSON().operationId;
        return route.fulfill({
          status: 503,
          headers: Object.fromEntries(result.headers),
          body: 'null',
        });
      }
      await route.fulfill({
        status: result.status,
        headers: Object.fromEntries(result.headers),
        body: Buffer.from(await result.arrayBuffer()),
      });
    });
    const documentResponse = await page.goto(origin);
    if (checkpointPage) {
      checkpointPage.verifyNavigation(documentResponse);
      mark('loopback-page-served');
    }
    await page.addScriptTag({ content: bundle });
    mark('mount-panel');
    async function mountLogin() {
      await page.evaluate(
        (args) => globalThis.Proof.mount(...args),
        [status.API_URL, status.ANON_KEY, school, member],
      );
      await login(page, mark);
    }
    if (login) await mountLogin();
    else
      try {
        await page.evaluate(
          (args) => globalThis.Proof.mount(...args),
          [status.API_URL, status.ANON_KEY, session, school, member],
        );
      } catch (error) {
        mark('mount-failed-' + mountFailure(error));
        throw error;
      }
    mark('wait-my-credentials-heading');
    await page.getByRole('heading', { name: 'My Credentials' }).waitFor();
    mark('read-approved');
    await page.getByText(/Current approved — SPL previous/).waitFor();
    await page.getByLabel('License type').selectOption('PPL');
    await page.getByLabel('License number').fill('001-SYN');
    await page.getByLabel('Issue date').fill('2025-01-01');
    await page.getByLabel('No expiry').check();
    await page.getByLabel('Synthetic supporting PNG').setInputFiles({
      name: 'synthetic.png',
      mimeType: 'image/png',
      buffer: Buffer.from(syntheticSample, 'base64'),
    });
    mark('submit');
    async function clickOwnerAction(action, name, expected) {
      const button = page.getByRole('button', { name });
      if (!login) return button.click();
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url() === status.API_URL + '/functions/v1/credential-owner' &&
            r.request().method() === 'POST' &&
            r.request().postDataJSON()?.action === action,
        ),
        button.click(),
      ]);
      requireStatus(response.status(), expected);
    }
    await clickOwnerAction('submit', 'Submit for review', 201);
    if (!login) {
      await page.getByRole('button', { name: 'Check submission outcome' }).click();
      await page.getByText('Submission confirmed.').waitFor();
    }
    if (login) mark('pending-render');
    await page.getByText(/Pending — PPL 001-SYN/).waitFor();
    await page.getByText(/Current approved — SPL previous/).waitFor();
    if (categoryProof) {
      await categoryProof(page, async () => {
        checkpointPage.verifyNavigation(await page.reload(), true);
        await page.addScriptTag({ content: bundle });
        await mountLogin();
        await page.getByRole('heading', { name: 'My Credentials' }).waitFor();
      });
      return;
    }
    if (replacementProof) {
      await replacementProof.run(page);
      return;
    }
    mark('preview');
    await clickOwnerAction('evidence', 'View pending evidence', 200);
    if (login) mark('private-image-render');
    await page.waitForFunction(() => {
      const img = globalThis.document.querySelector(
        'img[alt="Submitted synthetic supporting evidence"]',
      );
      return img?.complete && img.naturalWidth === 1;
    });
    assert.ok(seen.includes(201));
    console.log(
      'Submission proof passed: My Credentials submitted, rendered current and pending, and previewed the private PNG.',
    );
    return operation;
  } finally {
    try {
      await browser.close();
    } finally {
      if (checkpointPage) {
        let verified = false;
        try {
          await checkpointPage.close();
          verified = true;
        } finally {
          console.log(
            verified
              ? 'Checkpoint page listener shutdown verified.'
              : 'Checkpoint page listener shutdown failed.',
          );
        }
      }
    }
  }
}
