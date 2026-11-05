/* global document, window, getComputedStyle -- Browser-evaluated checks. */
import assert from 'node:assert/strict';
const rootSelector = '.aircraft-editor-foundation';
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
  assert.equal(result.overflow, false, 'Aircraft editor has no horizontal page overflow');
  for (const text of result.text)
    assert.ok(text.ratio >= 4.5, `Editor text contrast: ${text.name}`);
  for (const target of result.targets) {
    assert.ok(
      target.width >= 44 && target.height >= 44 && target.fits,
      `Editor target: ${target.name}`,
    );
    if (target.boundary !== null)
      assert.ok(target.boundary >= 3, `Editor boundary: ${target.name}`);
    if (target.focus !== null) assert.ok(target.focus >= 3, `Editor focus: ${target.name}`);
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

const correlationId = '30000000-0000-4000-8000-000000000040';
const record = {
  id: '50000000-0000-4000-8000-000000000001',
  registrationMark: 'DEMO-001',
  manufacturer: 'Synthetic Manufacturer',
  model: 'Synthetic Model',
  registryState: 'tracked',
  version: 4,
  updatedAt: '2026-10-24T00:00:00Z',
};

async function start(page, mockSupabase, submitLogin, state = {}) {
  state.writes = [];
  await mockSupabase(page, { admin: true });
  await page.route('**/functions/v1/aircraft-registry', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'list') {
      await route.fulfill({
        json: {
          decision: 'listed',
          records: [record],
          page: body.page,
          pageSize: 25,
          hasNext: false,
          correlationId,
        },
      });
      return;
    }
    assert.ok(['create', 'update'].includes(body.action));
    state.writes.push(body);
    if (state.gate) await state.gate;
    if (state.error) {
      await route.fulfill({
        status: state.error === 'unauthorized' ? 403 : 409,
        json: { error: { code: state.error }, correlationId },
      });
      return;
    }
    await route.fulfill({
      json: {
        decision: body.action === 'create' ? 'created' : 'updated',
        record: {
          ...record,
          ...body,
          version: 5,
          action: undefined,
          expectedVersion: undefined,
          idempotencyKey: undefined,
          recordId: undefined,
        },
        replayed: false,
        correlationId,
      },
    });
  });
  await page.goto('http://127.0.0.1:4173');
  await submitLogin(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Aircraft', exact: true }).click();
  await page.getByRole('button', { name: 'Edit record', exact: true }).waitFor();
}

async function widths(browser, mockSupabase, submitLogin) {
  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await start(page, mockSupabase, submitLogin);
      await page.getByRole('button', { name: 'Edit record', exact: true }).click();
      await page.locator(rootSelector).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await layout(page);
      for (const name of ['Registration mark', 'Manufacturer', 'Model']) {
        await page.keyboard.press('Tab');
        await focused(page.getByLabel(name, { exact: true }));
      }
      await page.getByLabel('Registration mark', { exact: true }).fill('X'.repeat(32));
      await page.getByLabel('Manufacturer', { exact: true }).fill('M'.repeat(100));
      await page.getByLabel('Model', { exact: true }).fill('𐐀'.repeat(100));
      await layout(page);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Add aircraft' }).click();
      await page.getByRole('button', { name: 'Save record' }).focus();
      await page.keyboard.press('Enter');
      const summary = page.locator('.validation-summary');
      await focused(summary);
      assert.equal(await summary.getByRole('link').count(), 3);
      for (const name of ['registration mark', 'manufacturer', 'model']) {
        await summary.getByRole('link', { name: new RegExp(`Enter a valid ${name}`) }).click();
        assert.equal(
          await page
            .getByRole('textbox', { name: new RegExp(name, 'i') })
            .evaluate((e) => e === document.activeElement),
          true,
        );
      }
      await layout(page);
      const tree = await page.locator(rootSelector).ariaSnapshot();
      assert.match(tree, /Required, up to 32 characters/);
      assert.match(tree, /button "Save record"/);
    } finally {
      await page.close();
    }
  }
}

async function states(browser, mockSupabase, submitLogin) {
  const page = await browser.newPage({ viewport: { width: 390, height: 420 }, hasTouch: true });
  const state = { error: 'service_unavailable' };
  try {
    await start(page, mockSupabase, submitLogin, state);
    await page.getByRole('button', { name: 'Edit record', exact: true }).click();
    await page.getByLabel('Model', { exact: true }).fill('Preserved attempt');
    await page.getByRole('button', { name: 'Save record' }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'Preserved attempt');
    await layout(page);
    state.error = 'version_conflict';
    await page.getByRole('button', { name: 'Save record' }).click();
    await page.getByText(/changed.*Review|Review.*latest/).waitFor();
    assert.equal(state.writes[0].idempotencyKey, state.writes[1].idempotencyKey);
    assert.equal(state.writes[1].expectedVersion, 4);
    assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'Preserved attempt');
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    assert.equal(await page.getByRole('button', { name: 'Save record' }).isDisabled(), true);
    await page.getByText(/Changes are not queued offline/).waitFor();
    await layout(page);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    state.error = undefined;
    let release;
    state.gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.getByRole('button', { name: 'Save record' }).click();
    await page.getByRole('button', { name: 'Saving…' }).waitFor();
    assert.match(
      await page.locator(rootSelector).getByRole('status').innerText(),
      /Saving aircraft record/,
    );
    assert.equal(
      await page.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(),
      true,
    );
    await layout(page);
    release();
    await page.getByText('DEMO-001 was saved.').waitFor();
    await page.getByRole('button', { name: 'Edit record', exact: true }).click();
    state.error = 'unauthorized';
    state.gate = undefined;
    await page.getByRole('button', { name: 'Save record' }).click();
    await page.locator(rootSelector).waitFor({ state: 'detached' });
  } finally {
    await page.close();
  }
}

export async function checkAircraftEditorFoundation(browser, mockSupabase, submitLogin) {
  await widths(browser, mockSupabase, submitLogin);
  await states(browser, mockSupabase, submitLogin);
  process.stdout.write(
    'PASS Aircraft editor foundation: six widths, long text, validation links, keyboard, contrast/targets, pending, offline, conflict, safe retry and revocation.\n',
  );
}
