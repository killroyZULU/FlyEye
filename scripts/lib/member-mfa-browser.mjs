import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

export function memberMfaBrowser() {
  let server;
  let browser;
  return {
    async start(apiUrl, publishableKey) {
      server = await createServer({
        server: { host: '127.0.0.1', port: 0, strictPort: true },
        define: {
          'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiUrl),
          'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(publishableKey),
        },
        logLevel: 'silent',
      });
      await server.listen();
      const address = server.httpServer.address();
      assert.ok(address && typeof address === 'object');
      return `http://127.0.0.1:${address.port}`;
    },
    async run({
      origin,
      email,
      password,
      currentTotp,
      enterStage,
      inspect,
      resume,
      checkpoint,
      onProviderFailure,
    }) {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({
        viewport: resume ? { width: 393, height: 851 } : { width: 1280, height: 800 },
      });
      page.setDefaultTimeout(15_000);
      let secret;
      let leaked = false;
      let enrollments = 0;
      let removals = 0;
      page.on('console', (message) => {
        const text = message.text();
        if (text.includes('otpauth://') || (secret && text.includes(secret))) leaked = true;
      });
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/auth/v1/factors' && request.method() === 'POST') enrollments++;
        if (url.pathname.startsWith('/auth/v1/factors/') && request.method() === 'DELETE')
          removals++;
      });
      page.on('response', (response) => {
        const pathname = new URL(response.url()).pathname;
        if (
          response.status() >= 400 &&
          (pathname.startsWith('/auth/v1/') || pathname.startsWith('/functions/v1/'))
        )
          onProviderFailure(response.status());
      });
      async function login() {
        enterStage('browser-password-login');
        await page.getByLabel('Email address').fill(email);
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Sign in securely' }).click();
        enterStage('browser-workspace');
        await page.getByRole('button', { name: 'Account security', exact: true }).click();
        enterStage('browser-security');
      }
      async function noCredential() {
        assert.equal(await page.locator('.manual-secret').count(), 0);
        assert.equal(await page.getByAltText('Authenticator setup QR code').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Show manual setup key' }).count(), 0);
      }
      enterStage('browser-page-load');
      await page.goto(origin);
      await login();
      await page.getByRole('button', { name: 'Begin secure setup' }).click();
      enterStage('browser-enrollment');
      await page.getByRole('heading', { name: 'Set up your authenticator', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Show manual setup key' }).click();
      enterStage('browser-secret');
      secret = (await page.getByLabel('Manual authenticator setup key').textContent()).trim();
      assert.ok(/^[A-Z2-7]+=*$/i.test(secret));
      enterStage('browser-bound');
      const bound = await inspect('bound');
      assert.equal(enrollments, 1);
      checkpoint();
      if (resume) {
        enterStage('browser-cancel-retained');
        await page.getByRole('button', { name: 'Cancel and sign out' }).click();
        await page.getByRole('button', { name: 'Sign in securely' }).waitFor();
        await noCredential();
        assert.equal(removals, 0);
        await inspect('retained', bound);
        enterStage('browser-resume');
        await login();
        await page.getByRole('button', { name: 'Resume secure setup' }).click();
        try {
          await page
            .getByRole('heading', { name: 'Verify your authenticator', exact: true })
            .waitFor();
        } catch {
          await page
            .getByRole('heading', { name: 'Authenticator setup is blocked', exact: true })
            .waitFor();
          await page
            .getByRole('alert')
            .filter({ hasText: 'Your authenticator information needs support review.' })
            .waitFor();
          await inspect('retained', bound);
          assert.equal(enrollments, 1);
          assert.equal(removals, 0);
          enterStage('browser-resume-conflict');
          throw new Error('Provider-backed bound-factor resume was rejected without mutation.');
        }
        await noCredential();
        await inspect('retained', bound);
        assert.equal(enrollments, 1);
      }
      enterStage('browser-invalid-code');
      const acceptedWindow = [-2, -1, 0, 1, 2].map((offset) => currentTotp(secret, offset));
      const invalid = ['000000', '111111', '222222', '333333', '444444', '555555'].find(
        (code) => !acceptedWindow.includes(code),
      );
      await page.getByLabel('Verification code', { exact: true }).fill(invalid);
      await page.getByRole('button', { name: 'Verify authenticator', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'invalid or expired' }).waitFor();
      await inspect('retained', bound);
      enterStage('browser-completion');
      await page.getByLabel('Verification code', { exact: true }).fill(currentTotp(secret));
      await page.getByRole('button', { name: 'Verify authenticator', exact: true }).click();
      await page.getByRole('heading', { name: 'Authenticator is ready', exact: true }).waitFor();
      await noCredential();
      await inspect('completed', bound);
      await page.getByRole('button', { name: 'Return to workspace' }).click();
      await page.getByRole('button', { name: 'Account security', exact: true }).click();
      await page.getByRole('heading', { name: 'Authenticator is ready', exact: true }).waitFor();
      await noCredential();
      assert.equal(enrollments, 1);
      assert.equal(removals, 0);
      assert.equal(leaked, false);
      secret = undefined;
      enterStage('browser-verified');
    },
    async closeBrowser() {
      await browser?.close();
      if (browser) assert.equal(browser.isConnected(), false);
    },
    async closeFrontend() {
      await server?.close();
      if (server) assert.equal(server.httpServer?.listening ?? false, false);
    },
  };
}
