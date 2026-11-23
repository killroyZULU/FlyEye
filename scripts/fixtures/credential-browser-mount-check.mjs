import assert from 'node:assert/strict';
import { mountFailure } from './credential-mount-result.mjs';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { browserOptions, prepareBrowser } from './credential-owner-browser.mjs';

// Service-free harness check. Only panel mount is asserted; no request leaves the browser fixture.
const origin = 'http://127.0.0.1:58329',
  api = 'http://127.0.0.1:58321',
  actor = randomUUID(),
  member = randomUUID(),
  school = randomUUID();
const segment = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const token = [
  segment({ alg: 'HS256', typ: 'JWT' }),
  segment({
    sub: actor,
    aal: 'aal2',
    amr: [
      { method: 'password', timestamp: 1 },
      { method: 'totp', timestamp: 1 },
    ],
    session_id: randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 600,
  }),
  'c3R1Yg',
].join('.');
const bundle = await prepareBrowser();
const browser = await chromium.launch(browserOptions);
try {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const endpoints = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><div id="root"></div>',
      });
    if (url.origin !== api) return route.abort();
    endpoints.push(
      url.pathname === '/auth/v1/user'
        ? 'user'
        : url.pathname.endsWith('member-administration')
          ? 'metadata'
          : 'other',
    );
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({
      status: 200,
      headers,
      json: url.pathname === '/auth/v1/user' ? { id: actor } : {},
    });
  });
  await page.goto(origin);
  await page.addScriptTag({ content: bundle });
  try {
    await page.evaluate(
      (args) => globalThis.Proof.mount(...args),
      [
        api,
        'synthetic-public',
        { access_token: token, refresh_token: 'synthetic-refresh' },
        school,
        member,
      ],
    );
    await page.getByRole('heading', { name: 'My Credentials' }).waitFor({ timeout: 4000 });
    await assert.rejects(
      page.evaluate(
        (args) => globalThis.Proof.mount(...args),
        [api, 'synthetic-public', {}, school, member],
      ),
      (error) => mountFailure(error) === 'missing-session',
    );
    console.log('Offline owner panel mount and bounded missing-session category passed.');
  } catch (error) {
    console.error(
      'Offline mount failed:',
      mountFailure(error),
      'request categories:',
      endpoints.join(','),
    );
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
