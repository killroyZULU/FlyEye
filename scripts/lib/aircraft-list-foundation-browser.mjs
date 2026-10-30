/* global document, getComputedStyle -- Browser-evaluated checks. */
import assert from 'node:assert/strict';

const rootSelector = '.aircraft-list-foundation';
const correlationId = '30000000-0000-4000-8000-000000000040';

function record(index, long = false) {
  return {
    id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    registrationMark: long ? String(index + 1).padEnd(32, 'X') : `DEMO-${index + 1}`,
    manufacturer: long ? 'Synthetic manufacturer '.padEnd(100, 'M') : 'Synthetic Manufacturer',
    model: long ? 'Synthetic model '.padEnd(100, 'X') : 'Training Model',
    registryState: 'tracked',
    version: 1,
    updatedAt: '2026-10-19T00:00:00Z',
  };
}

async function mockRegistry(page, state = {}) {
  state.requests = [];
  await page.route('**/functions/v1/aircraft-registry', async (route) => {
    const body = route.request().postDataJSON();
    state.requests.push(body);
    assert.equal(body.action, 'list', 'List checks never execute a protected mutation');
    if (state.gate) await state.gate;
    if (state.error) {
      await route.fulfill({
        status: state.error === 'unauthorized' ? 403 : 503,
        json: { error: { code: state.error }, correlationId },
      });
      return;
    }
    const records = Array.from({ length: state.count ?? 1 }, (_, i) => record(i, state.long));
    if (body.includeArchived && records.length) records.at(-1).registryState = 'archived';
    await route.fulfill({
      json: {
        decision: 'listed',
        records: body.search === 'no-match' ? [] : records,
        page: body.page,
        pageSize: body.pageSize,
        hasNext: body.page === 1 && Boolean(state.next),
        correlationId,
      },
    });
  });
  return state;
}

async function layout(page) {
  const result = await page.locator(rootSelector).evaluate((root) => {
    const contrast = (a, b) => {
      const lum = (color) =>
        color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4))
          .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      const x = lum(a),
        y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const background = (e) => {
      while (getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)' && e.parentElement)
        e = e.parentElement;
      return getComputedStyle(e).backgroundColor;
    };
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      text: [
        ...root.querySelectorAll(
          'h2, p:not(.sr-only), span, strong, time, button, input:not([type=checkbox])',
        ),
      ]
        .filter(
          (e) =>
            e.getClientRects().length &&
            !e.closest('.sr-only') &&
            (e.textContent.trim() || e.tagName === 'INPUT'),
        )
        .map((e) => ({
          name: e.textContent.slice(0, 40),
          ratio: contrast(getComputedStyle(e).color, background(e)),
        })),
      targets: [...root.querySelectorAll('button, input')].map((e) => {
        const target = e.type === 'checkbox' ? e.closest('label') : e;
        const r = target.getBoundingClientRect(),
          style = getComputedStyle(e);
        return {
          name: e.textContent || e.type,
          width: r.width,
          height: r.height,
          fits: r.left >= 0 && r.right <= document.documentElement.clientWidth + 1,
          focus: e.matches(':focus-visible')
            ? contrast(style.outlineColor, background(e.parentElement))
            : null,
          boundary:
            e.type === 'checkbox'
              ? null
              : contrast(style.borderTopColor, background(e.parentElement)),
        };
      }),
    };
  });
  assert.equal(result.overflow, false, 'Aircraft list has no horizontal page overflow');
  for (const text of result.text) assert.ok(text.ratio >= 4.5, `List text contrast: ${text.name}`);
  for (const target of result.targets) {
    assert.ok(
      target.width >= 44 && target.height >= 44 && target.fits,
      `List target: ${target.name}`,
    );
    if (target.boundary !== null) assert.ok(target.boundary >= 3, `List boundary: ${target.name}`);
    if (target.focus !== null) assert.ok(target.focus >= 3, `List focus: ${target.name}`);
  }
}

async function focused(locator) {
  // Keyboard focus styling may settle after the key event in touch emulation.
  await locator
    .page()
    .waitForFunction(
      (e) =>
        e === document.activeElement &&
        e.matches(':focus-visible') &&
        getComputedStyle(e).outlineWidth === '2px',
      await locator.elementHandle(),
      { timeout: 5_000 },
    );
  assert.equal(await locator.evaluate((e) => e === document.activeElement), true);
  assert.equal(await locator.evaluate((e) => getComputedStyle(e).outlineWidth), '2px');
  await locator.scrollIntoViewIfNeeded();
  assert.equal(
    await locator.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= globalThis.innerHeight + 1;
    }),
    true,
  );
}

async function start(page, mockSupabase, submitLogin, state) {
  await mockSupabase(page, { admin: true });
  await mockRegistry(page, state);
  await page.goto('http://127.0.0.1:4173');
  await submitLogin(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Aircraft', exact: true }).click();
  await page.getByRole('heading', { name: 'Aircraft registry', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
}

async function checkWidths(browser, mockSupabase, submitLogin) {
  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await start(page, mockSupabase, submitLogin, { long: true, count: 25 });
      await page.locator('.aircraft-list li').nth(24).waitFor();
      await layout(page);
      const root = page.locator(rootSelector);
      await root.getByRole('button', { name: 'Back', exact: true }).focus();
      for (const control of [
        root.getByRole('textbox'),
        root.getByRole('button', { name: 'Search', exact: true }),
        root.getByRole('checkbox'),
        root.getByRole('button', { name: 'Add aircraft' }),
        root.getByRole('button', { name: 'Edit record' }).first(),
      ]) {
        await page.keyboard.press('Tab');
        await focused(control);
      }
      await layout(page);
      const tree = await root.ariaSnapshot();
      assert.match(tree, /Search registration, manufacturer, or model/);
      assert.match(tree, /checkbox "Include archived"/);
      assert.match(tree, /tracked/);
      assert.match(tree, /Page 1/);
      await root.getByRole('button', { name: 'Archive record' }).first().click();
      const dialog = page.getByRole('dialog');
      assert.equal(await dialog.locator(rootSelector).count(), 0);
      assert.equal(
        await dialog.evaluate((e) => e.closest('.aircraft-list-foundation') !== null),
        false,
      );
      assert.match(
        await dialog.locator('h3').evaluate((e) => getComputedStyle(e).fontFamily),
        /Georgia/,
      );
      await page.keyboard.press('Escape');
      await focused(root.getByRole('button', { name: 'Archive record' }).first());
      await root.getByRole('button', { name: 'Edit record' }).first().click();
      assert.equal(await page.locator(rootSelector).count(), 0);
      assert.match(
        await page
          .locator('#aircraft-editor-heading')
          .evaluate((e) => getComputedStyle(e).fontFamily),
        /Archivo/,
      );
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.locator('.aircraft-list li').nth(24).waitFor();
    } finally {
      await page.close();
    }
  }
}

async function checkStates(browser, mockSupabase, submitLogin) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const state = { count: 1, next: true };
  try {
    await start(page, mockSupabase, submitLogin, state);
    await page.getByText('DEMO-1', { exact: true }).waitFor();
    const root = page.locator(rootSelector),
      search = root.getByRole('textbox');
    await layout(page);
    await search.fill('no-match');
    await search.press('Enter');
    await page.getByText('No aircraft match these filters.').waitFor();
    await layout(page);
    await search.fill('literal%_');
    await search.press('Enter');
    await page.getByText('DEMO-1', { exact: true }).waitFor();
    await root.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Reactivate record' }).waitFor();
    await root.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText('Page 2', { exact: true }).waitFor();
    assert.equal(await search.inputValue(), 'literal%_');
    assert.equal(state.requests.at(-1).search, 'literal%_');
    assert.equal(state.requests.at(-1).includeArchived, true);
    await root.getByRole('button', { name: 'Previous', exact: true }).click();
    await page.getByText('Page 1', { exact: true }).waitFor();
    let release;
    state.gate = new Promise((resolve) => {
      release = resolve;
    });
    await search.press('Enter');
    await page.getByText('Loading aircraft registry…').waitFor();
    assert.equal(
      await root.getByRole('button', { name: 'Search', exact: true }).isDisabled(),
      true,
    );
    await layout(page);
    state.gate = undefined;
    release();
    await page.getByText('Loading aircraft registry…').waitFor({ state: 'hidden' });
    state.error = 'service_unavailable';
    await search.press('Enter');
    await page.getByRole('alert').waitFor();
    assert.equal(await search.inputValue(), 'literal%_');
    await layout(page);
    state.error = undefined;
    await page.context().setOffline(true);
    await page
      .getByText('You are offline. Any visible current-session results may be stale.')
      .waitFor();
    assert.equal(await root.getByRole('button', { name: 'Add aircraft' }).isDisabled(), true);
    assert.equal(await root.getByRole('button', { name: 'Reactivate record' }).isDisabled(), true);
    await layout(page);
    await page.context().setOffline(false);
    await page.getByRole('alert').waitFor({ state: 'hidden' });
    state.error = 'unauthorized';
    await search.press('Enter');
    await page.locator(rootSelector).waitFor({ state: 'hidden' });
    assert.equal(await page.getByText('DEMO-1', { exact: true }).count(), 0);
  } finally {
    await page.close();
  }
  for (const count of [0, 1]) {
    const probe = await browser.newPage({
      viewport: { width: 768, height: 360 },
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    try {
      await probe.route('**/fonts/**', (route) => route.abort());
      await start(probe, mockSupabase, submitLogin, { count });
      await probe
        .getByText(count ? 'DEMO-1' : 'No Tracked aircraft records yet.', { exact: true })
        .waitFor();
      await layout(probe);
      await probe.locator(rootSelector).getByRole('textbox').focus();
      await probe.keyboard.press('Tab');
      await focused(probe.getByRole('button', { name: 'Search', exact: true }));
      await probe.setViewportSize({ width: 390, height: 360 });
      await layout(probe);
    } finally {
      await probe.close();
    }
  }
}

export async function checkAircraftListFoundation(browser, mockSupabase, submitLogin) {
  await checkWidths(browser, mockSupabase, submitLogin);
  await checkStates(browser, mockSupabase, submitLogin);
  process.stdout.write(
    'Aircraft list foundation: responsive, keyboard, contrast, state and isolation checks passed.\n',
  );
}
