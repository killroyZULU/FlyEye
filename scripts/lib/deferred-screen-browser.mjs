import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:4173';

export async function checkDeferredScreens(browser, manifest, mockSupabase, submitLogin) {
  const fileFor = (name) => {
    const entry = Object.entries(manifest).find(([key]) => key.endsWith(`/${name}.tsx`));
    assert.ok(entry?.[1].isDynamicEntry, `Missing deferred screen: ${name}`);
    return `/${entry[1].file}`;
  };
  const workspace = fileFor('AuthenticatedWorkspace');
  const profile = fileFor('MemberProfilePanel');
  const protectedFiles = [
    'AircraftRegistryPanel',
    'AircraftDocumentsPanel',
    'MemberAdministrationPanel',
    'MemberInvitationsPanel',
    'MemberMfaEnrollmentFlow',
  ].map(fileFor);
  const entryFiles = ['RecoveryRequestForm', 'AdminOnboardingFlow'].map(fileFor);

  async function run(name, check) {
    const page = await browser.newPage({ viewport: { width: 393, height: 851 } });
    const errors = [];
    page.on('pageerror', () => errors.push('page error'));
    try {
      await mockSupabase(page);
      await check(page);
      assert.deepEqual(errors, [], 'Unexpected uncaught browser error.');
      process.stdout.write(`PASS production deferred screen: ${name}\n`);
    } finally {
      await page.close();
    }
  }

  await run('requests follow verified navigation', async (page) => {
    const requests = new Set();
    page.on('request', (request) => requests.add(new URL(request.url()).pathname));
    await page.goto(origin);
    await page.getByRole('heading', { name: 'Sign in to FlyEye' }).waitFor();
    for (const file of [workspace, profile, ...protectedFiles, ...entryFiles])
      assert.equal(requests.has(file), false);
    await submitLogin(page);
    await page.getByRole('heading', { name: 'Student dashboard' }).waitFor();
    assert.equal(requests.has(workspace), true);
    for (const file of [profile, ...protectedFiles, ...entryFiles])
      assert.equal(requests.has(file), false);
    const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
    assert.equal(await navigation.getByRole('button', { name: 'People', exact: true }).count(), 0);
    assert.equal(
      await navigation.getByRole('button', { name: 'Aircraft', exact: true }).count(),
      0,
    );
    await navigation.getByRole('button', { name: 'My profile', exact: true }).click();
    await page.getByRole('heading', { name: 'My basic profile', exact: true }).waitFor();
    assert.equal(requests.has(profile), true);
    for (const file of protectedFiles) assert.equal(requests.has(file), false);
    const overflows = await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
    );
    assert.equal(overflows, false);
  });

  await run('sign out while workspace import is pending', async (page) => {
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route(`**${workspace}`, async (route) => {
      await held;
      await route.continue();
    });
    try {
      await page.goto(origin);
      await submitLogin(page);
      await page.getByRole('heading', { name: 'Loading this screen' }).waitFor();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('heading', { name: 'Sign in to FlyEye' }).waitFor();
      const loaded = page.waitForResponse(
        (response) => new URL(response.url()).pathname === workspace,
      );
      release();
      await loaded;
      await page.waitForLoadState('networkidle');
      assert.equal(await page.getByRole('heading', { name: 'Student dashboard' }).count(), 0);
      assert.equal(await page.getByRole('navigation', { name: 'Primary navigation' }).count(), 0);
    } finally {
      release();
    }
  });

  await run('recovery scrubs its credential without deferred chunks', async (page) => {
    let deferredRequests = 0;
    const deferredFiles = new Set([workspace, profile, ...protectedFiles, ...entryFiles]);
    await page.route('**/assets/*.js', async (route) => {
      if (deferredFiles.has(new URL(route.request().url()).pathname)) {
        deferredRequests += 1;
        await route.abort('failed');
      } else await route.continue();
    });
    await page.goto(`${origin}/auth/recovery?token_hash=synthetic-recovery-token-hash-1234567890`);
    await page.getByRole('heading', { name: 'Continue password recovery?' }).waitFor();
    assert.equal(new URL(page.url()).search, '');
    assert.equal(deferredRequests, 0);
  });

  for (const endSession of [false, true]) {
    await run(
      endSession
        ? 'session-ended notification during module import'
        : 'navigate away during module import',
      async (page) => {
        let release;
        const held = new Promise((resolve) => {
          release = resolve;
        });
        let memberRequests = 0;
        page.on('request', (request) => {
          if (new URL(request.url()).pathname.endsWith('/member-administration'))
            memberRequests += 1;
        });
        await page.route(`**${profile}`, async (route) => {
          await held;
          await route.continue();
        });
        try {
          await page.goto(origin);
          await submitLogin(page);
          const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
          await navigation.getByRole('button', { name: 'My profile', exact: true }).click();
          await page.getByRole('heading', { name: 'Loading this screen' }).waitFor();
          assert.equal(await navigation.isVisible(), true);
          if (endSession) {
            await page.evaluate(() => {
              const key = Object.keys(localStorage).find((item) => item.endsWith('-auth-token'));
              if (!key) throw new Error('Synthetic session storage missing.');
              const channel = new BroadcastChannel(key);
              channel.postMessage({ event: 'SIGNED_OUT', session: null });
              channel.close();
            });
            await page.getByRole('heading', { name: 'Sign in to FlyEye' }).waitFor();
          } else {
            await navigation.getByRole('button', { name: 'Home', exact: true }).click();
            await page.getByRole('heading', { name: 'Student dashboard' }).waitFor();
          }
          const loaded = page.waitForResponse(
            (response) => new URL(response.url()).pathname === profile,
          );
          release();
          await loaded;
          await page.waitForLoadState('networkidle');
          assert.equal(memberRequests, 0, 'An abandoned lazy screen must not issue data requests.');
          assert.equal(
            await page.getByRole('heading', { name: 'My basic profile', exact: true }).count(),
            0,
          );
          if (endSession) assert.equal(await navigation.count(), 0);
        } finally {
          release();
        }
      },
    );
  }

  await run('failed module keeps navigation and recovers after explicit reload', async (page) => {
    let attempts = 0;
    await page.route(`**${profile}`, async (route) => {
      attempts += 1;
      if (attempts === 1) await route.abort('failed');
      else await route.continue();
    });
    await page.goto(origin);
    await submitLogin(page);
    let navigation = page.getByRole('navigation', { name: 'Primary navigation' });
    await navigation.getByRole('button', { name: 'My profile', exact: true }).click();
    await page.getByRole('heading', { name: 'This screen could not load' }).waitFor();
    assert.equal(await navigation.isVisible(), true);
    assert.equal(
      await page.getByRole('button', { name: 'Sign out', exact: true }).isVisible(),
      true,
    );
    assert.equal(attempts, 1);
    await page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
    await page.getByRole('heading', { name: 'Student dashboard' }).waitFor();
    await navigation.getByRole('button', { name: 'My profile', exact: true }).click();
    await page.getByRole('heading', { name: 'This screen could not load' }).waitFor();
    assert.equal(attempts, 1, 'Do not automatically retry a cached failed import.');
    await page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await page.getByRole('heading', { name: 'Student dashboard' }).waitFor();
    navigation = page.getByRole('navigation', { name: 'Primary navigation' });
    await navigation.getByRole('button', { name: 'My profile', exact: true }).click();
    await page.getByRole('heading', { name: 'My basic profile', exact: true }).waitFor();
    assert.equal(attempts, 2);
  });
}
