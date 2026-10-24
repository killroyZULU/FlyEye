import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:4173';
const targets = [
  {
    module: 'registry',
    navigation: 'Aircraft',
    endpoint: 'aircraft-registry',
    error: 'The aircraft registry is temporarily unavailable. Try again.',
  },
  {
    module: 'document',
    navigation: 'Aircraft documents',
    endpoint: 'aircraft-documents',
    error: 'Aircraft documents are temporarily unavailable. Try again.',
  },
];

export async function checkDeferredAircraftGateways(browser, manifest, mockSupabase, submitLogin) {
  for (const target of targets) {
    const entry = Object.entries(manifest).find(([key]) =>
      key.endsWith(`/${target.module}-gateway-implementation.ts`),
    );
    assert.ok(entry?.[1].isDynamicEntry, 'Aircraft gateway must be a dynamic entry.');
    const file = `/${entry[1].file}`;
    for (const scenario of ['load', 'failure', 'sign-out']) {
      const page = await browser.newPage();
      const errors = [];
      let moduleRequests = 0;
      let commands = 0;
      let bootstraps = 0;
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      page.on('pageerror', () => errors.push('page error'));
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (path.endsWith(`/functions/v1/${target.endpoint}`)) commands++;
        if (path.endsWith('/functions/v1/auth-bootstrap')) bootstraps++;
      });
      try {
        await mockSupabase(page, { admin: true });
        await page.route(`**${file}`, async (route) => {
          moduleRequests++;
          if (scenario === 'failure') await route.abort('failed');
          else {
            if (scenario === 'sign-out') await held;
            await route.continue();
          }
        });
        await page.goto(origin);
        await page.getByRole('heading', { name: 'Sign in to FlyEye' }).waitFor();
        assert.equal(moduleRequests, 0);
        await submitLogin(page);
        const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
        await navigation.waitFor();
        assert.equal(moduleRequests, 0);
        const started = page.waitForRequest((request) => new URL(request.url()).pathname === file);
        started.catch(() => {});
        const firstCommand =
          scenario === 'failure'
            ? undefined
            : page.waitForResponse((response) =>
                new URL(response.url()).pathname.endsWith(`/functions/v1/${target.endpoint}`),
              );
        // A cleanup/failure before settlement must not leave an unhandled waiter.
        firstCommand?.catch(() => {});
        await navigation.getByRole('button', { name: target.navigation, exact: true }).click();
        await started;
        if (scenario === 'failure') {
          await page.getByText(target.error, { exact: true }).waitFor();
          await page.waitForLoadState('networkidle');
          assert.equal(moduleRequests, 1);
          assert.equal(commands, 0);
          await page.unroute(`**${file}`);
          await page.reload();
          await page.getByRole('navigation', { name: 'Primary navigation' }).waitFor();
          const response = page.waitForResponse((result) =>
            new URL(result.url()).pathname.endsWith(`/functions/v1/${target.endpoint}`),
          );
          response.catch(() => {});
          await page
            .getByRole('navigation', { name: 'Primary navigation' })
            .getByRole('button', { name: target.navigation, exact: true })
            .click();
          assert.equal((await response).status(), 200);
        } else if (scenario === 'sign-out') {
          assert.equal(commands, 0);
          await page.getByRole('button', { name: 'Sign out', exact: true }).click();
          await page.getByRole('heading', { name: 'Sign in to FlyEye' }).waitFor();
          const count = bootstraps;
          await page.route(`**/functions/v1/${target.endpoint}`, (route) =>
            route.fulfill({
              status: 403,
              json: {
                error: { code: 'unauthorized' },
                correlationId: '40000000-0000-4000-8000-000000000001',
              },
            }),
          );
          release();
          assert.equal((await firstCommand).status(), 403);
          await page.waitForLoadState('networkidle');
          assert.equal(
            await page.getByRole('navigation', { name: 'Primary navigation' }).count(),
            0,
          );
          assert.equal(bootstraps, count, 'Module settlement must not restart auth bootstrap.');
        } else {
          assert.equal((await firstCommand).status(), 200);
          await page.waitForLoadState('networkidle');
          assert.ok(commands > 0);
          assert.equal(moduleRequests, 1);
        }
        assert.deepEqual(errors, []);
        process.stdout.write(`PASS deferred aircraft gateway: ${target.module} ${scenario}.\n`);
      } finally {
        release();
        await page.close();
      }
    }
  }
}
