/* global document, getComputedStyle, requestAnimationFrame -- Browser-evaluated callbacks. */
import assert from 'node:assert/strict';

async function layout(page) {
  const result = await page.locator('.profile-foundation').evaluate((root) => {
    const contrast = (a, b) => {
      const luminance = (color) =>
        color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4))
          .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const background = (element) => {
      while (
        getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)' &&
        element.parentElement
      )
        element = element.parentElement;
      return getComputedStyle(element).backgroundColor;
    };
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      pairs: [...root.querySelectorAll('h2, p, span, strong, label, input, button, a')]
        .filter((e) => e.getClientRects().length && (e.textContent.trim() || e.tagName === 'INPUT'))
        .map((e) => ({
          name: e.textContent || e.id,
          ratio: contrast(getComputedStyle(e).color, background(e)),
        })),
      controls: [...root.querySelectorAll('input, button')].map((e) => {
        const r = e.getBoundingClientRect(),
          style = getComputedStyle(e);
        return {
          name: e.id || e.textContent,
          width: r.width,
          height: r.height,
          fits: r.left >= 0 && r.right <= document.documentElement.clientWidth + 1,
          boundary: contrast(style.borderTopColor, background(e.parentElement)),
          focus: contrast(style.outlineColor, background(e.parentElement)),
          focused: e.matches(':focus-visible'),
        };
      }),
    };
  });
  assert.equal(result.overflow, false, 'Profile has no horizontal page overflow');
  for (const pair of result.pairs)
    assert.ok(pair.ratio >= 4.5, `Profile text contrast: ${pair.name}`);
  for (const control of result.controls) {
    assert.ok(
      control.width >= 44 && control.height >= 44 && control.fits,
      `Profile target: ${control.name}`,
    );
    assert.ok(control.boundary >= 3, `Profile control boundary: ${control.name}`);
    if (control.focused) assert.ok(control.focus >= 3, `Profile focus contrast: ${control.name}`);
  }
}

async function focus(locator) {
  await locator
    .page()
    .evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  const result = await locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return {
      active: e === document.activeElement,
      outline: getComputedStyle(e).outlineWidth,
      visible: r.top >= -1 && r.bottom <= globalThis.innerHeight + 1,
    };
  });
  assert.deepEqual(result, { active: true, outline: '2px', visible: true });
}

export async function checkProfileFoundation(browser, mockSupabase, submitLogin) {
  const start = async (page) => {
    await page.goto('http://127.0.0.1:4173');
    await submitLogin(page);
    await page
      .getByRole('navigation')
      .getByRole('button', { name: 'My profile', exact: true })
      .click();
    await page.getByRole('heading', { name: 'My basic profile' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
  };
  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await mockSupabase(page);
      await mockProfile(page, { long: true });
      await start(page);
      await page.getByLabel('Display name', { exact: true }).waitFor();
      await layout(page);
      const back = page.getByRole('button', { name: 'Back to workspace' });
      await back.focus();
      await page.keyboard.press('Tab');
      await focus(page.getByLabel('Display name', { exact: true }));
      await page.keyboard.press('Tab');
      await focus(page.getByLabel('Contact number (optional)'));
      await page.keyboard.press('Tab');
      await focus(page.getByRole('button', { name: 'Save profile' }));
      await page.keyboard.press('Enter');
      await page.getByRole('alert').waitFor();
      await focus(page.getByRole('alert'));
      await layout(page);
      await page.getByRole('alert').getByRole('link').click();
      assert.equal(
        await page.getByLabel('Display name', { exact: true }).getAttribute('aria-invalid'),
        'true',
      );
      const cdp = await page.context().newCDPSession(page);
      const tree = await cdp.send('Accessibility.getFullAXTree');
      for (const name of ['Display name', 'Contact number (optional)'])
        assert.ok(
          tree.nodes.some(
            (n) => !n.ignored && n.role.value === 'textbox' && n.name?.value === name,
          ),
        );
    } finally {
      await page.close();
    }
  }

  for (const failed of [false, true]) {
    const probe = await browser.newPage({
      viewport: { width: 390, height: 400 },
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    let releaseLoad = () => {};
    try {
      await mockSupabase(probe);
      await probe.route('**/fonts/*.woff2', (route) => route.abort());
      const state = {
        loadFailure: failed,
        loadHold: new Promise((resolve) => {
          releaseLoad = resolve;
        }),
      };
      await mockProfile(probe, state);
      await start(probe);
      await probe.getByText('Loading your current organization profile.').waitFor();
      assert.equal(
        await probe
          .locator('.loading-line')
          .evaluate((e) => getComputedStyle(e, '::after').animationName),
        'none',
      );
      await layout(probe);
      releaseLoad();
      if (failed) {
        await probe.getByText('The requested member information is not available.').waitFor();
        assert.equal(await probe.locator('.profile-foundation input').count(), 0);
        await layout(probe);
      } else {
        await probe.getByLabel('Display name', { exact: true }).waitFor();
        assert.equal(
          await probe.evaluate(() => document.fonts.check('400 16px "IBM Plex Sans"')),
          false,
        );
        for (const viewport of [
          { width: 768, height: 1024 },
          { width: 1024, height: 768 },
          { width: 390, height: 400 },
        ]) {
          await probe.setViewportSize(viewport);
          await layout(probe);
          await probe.getByLabel('Contact number (optional)').focus();
          await probe.keyboard.press('Tab');
          await focus(probe.getByRole('button', { name: 'Save profile' }));
        }
      }
      await probe.getByRole('button', { name: 'Back to workspace' }).tap();
      assert.equal(await probe.locator('.profile-foundation').count(), 0);
    } finally {
      releaseLoad();
      await probe.close();
    }
  }

  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  let release = () => {};
  try {
    await mockSupabase(page);
    const state = { mode: 'success', requests: [], hold: null };
    await mockProfile(page, state);
    await start(page);
    const name = page.getByLabel('Display name', { exact: true });
    const phone = page.getByLabel('Contact number (optional)');
    await name.fill('  Synthetic Updated Member  ');
    await phone.fill('+63 917 000 0000');
    state.hold = new Promise((resolve) => {
      release = resolve;
    });
    await page.getByRole('button', { name: 'Save profile' }).tap();
    const pending = page.getByRole('button', { name: 'Saving profile' });
    await pending.waitFor();
    assert.equal(await pending.isDisabled(), true);
    assert.equal(await name.isDisabled(), true);
    assert.equal(await phone.isDisabled(), true);
    await pending.evaluate((e) => {
      e.click();
      e.click();
    });
    await layout(page);
    release();
    await page.getByText('Your organization profile was saved.').waitFor();
    assert.equal(state.requests.length, 1, 'Repeated activation while pending sends one save');
    assert.deepEqual(state.requests[0], {
      action: 'update_profile',
      membershipId,
      displayName: 'Synthetic Updated Member',
      contactNumber: '+63 917 000 0000',
      expectedVersion: 1,
    });
    assert.equal(await name.inputValue(), 'Synthetic Updated Member');
    await layout(page);
    for (const [mode, message] of [
      ['conflict', 'The member information changed. Refresh and try again.'],
      ['unavailable', 'Member administration is temporarily unavailable.'],
    ]) {
      state.mode = mode;
      await name.fill('Synthetic unsaved edit');
      await page.getByRole('button', { name: 'Save profile' }).tap();
      await page.getByText(message, { exact: true }).waitFor();
      assert.equal(await name.inputValue(), 'Synthetic unsaved edit');
      assert.equal(await phone.inputValue(), '+63 917 000 0000');
      assert.equal(state.requests.at(-1).expectedVersion, 2);
      await layout(page);
    }
    const count = state.requests.length;
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }),
    );
    await page.getByRole('button', { name: 'Save profile' }).tap();
    await page
      .getByText('You are offline. Profile changes are not queued; reconnect and try again.')
      .waitFor();
    assert.equal(await name.inputValue(), 'Synthetic unsaved edit');
    assert.equal(state.requests.length, count);
    await layout(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      globalThis.dispatchEvent(new Event('online'));
    });
    assert.equal(state.requests.length, count, 'Reconnection does not enqueue a save');
    await page.getByRole('button', { name: 'Back to workspace' }).tap();
    assert.equal(await page.locator('.profile-foundation').count(), 0);
  } finally {
    release();
    await page.close();
  }
  process.stdout.write(
    'PASS profile foundation: six widths, long context, contrast/targets, keyboard/validation focus, accessible field names, pending repeated activation, exact versioned save, conflict/failure/offline input preservation, loading/unavailable, reduced motion, font fallback and touch/orientation/reduced-height reachability.\n',
  );
}

const membershipId = '10000000-0000-4000-8000-000000000001';
async function mockProfile(page, state) {
  await page.route('**/functions/v1/member-administration', async (route) => {
    const body = route.request().postDataJSON();
    const updating = body.action === 'update_profile';
    assert.ok(updating || body.action === 'get_profile');
    if (!updating && state.loadHold) await state.loadHold;
    if (!updating && state.loadFailure) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'member_administration.not_found' } }),
      });
      return;
    }
    if (updating) {
      state.requests.push(body);
      if (state.hold) await state.hold;
      if (state.mode !== 'success') {
        await route.fulfill({
          status: state.mode === 'conflict' ? 409 : 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code:
                state.mode === 'conflict'
                  ? 'member_administration.state_conflict'
                  : 'member_administration.unavailable',
            },
          }),
        });
        return;
      }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        decision: updating ? 'updated' : 'found',
        correlationId: '30000000-0000-4000-8000-000000000020',
        profile: {
          membershipId,
          organizationId: '20000000-0000-4000-8000-000000000001',
          organizationName: state.long
            ? 'Synthetic Flight School for Professional Aviation Training and Instruction — Long Name Verification'
            : 'Synthetic Flight School',
          displayName: updating ? body.displayName : null,
          contactNumber: updating ? body.contactNumber || null : null,
          email: state.long
            ? 'synthetic.long.profile.verification.member@example.test'
            : 'member@example.test',
          roleCode: 'student_pilot',
          roleLabel: 'Student Pilot',
          status: 'active',
          version: updating ? body.expectedVersion + 1 : 1,
          complete: updating,
        },
      }),
    });
  });
}
