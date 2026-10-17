/* global document, getComputedStyle -- Used only inside browser-evaluated callbacks. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const sizes = [320, 390, 768, 1024, 1280, 1440];

async function inspectLayout(page) {
  return page.evaluate(() => {
    const contrast = (first, second) => {
      const luminance = (color) => {
        const channels = color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((c) => {
            const value = c / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const a = luminance(first),
        b = luminance(second);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const rows = [
      ...document.querySelectorAll(
        '.auth-shell--password input, .auth-shell--password button, .auth-shell--password a',
      ),
    ].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        name: element.getAttribute('aria-label') || element.id || element.textContent.trim(),
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        focusable: element.tabIndex >= 0,
      };
    });
    const pairs = [
      ...document.querySelectorAll(
        '.auth-shell--password h1, .auth-shell--password h2, .auth-shell--password p, .auth-shell--password label, .auth-shell--password button, .auth-shell--password a, .auth-shell--password .eyebrow, .auth-shell--password .field-error, .auth-shell--password .status-message, .auth-shell--password footer',
      ),
    ]
      .filter((element) => element.getClientRects().length && element.textContent.trim())
      .map((element) => {
        const style = getComputedStyle(element);
        let parent = element,
          background = style.backgroundColor;
        while (background === 'rgba(0, 0, 0, 0)' && parent.parentElement) {
          parent = parent.parentElement;
          background = getComputedStyle(parent).backgroundColor;
        }
        return { text: element.textContent.trim(), ratio: contrast(style.color, background) };
      });
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      rows,
      pairs,
      heading: getComputedStyle(document.querySelector('.section-heading h2')).fontFamily,
    };
  });
}

function assertLayout(result, width) {
  assert.equal(result.overflow, false, `No page overflow at ${width}`);
  for (const row of result.rows) {
    assert.ok(row.width >= 44 && row.height >= 44, `Target size: ${row.name} at ${width}`);
    assert.ok(row.left >= 0 && row.right <= width + 1, `Visible control: ${row.name} at ${width}`);
  }
  for (const pair of result.pairs) assert.ok(pair.ratio >= 4.5, `Text contrast: ${pair.text}`);
  assert.match(result.heading, /Archivo/);
}

export async function checkSignInFoundation(browser, mockSupabase, options = {}) {
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:4173';
  const evidence = options.evidenceDirectory;
  if (evidence) await fs.mkdir(evidence, { recursive: true });
  const capture = async (page, name) => {
    if (evidence)
      await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
  };
  for (const width of sizes) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await mockSupabase(page, { invalid: true });
      await page.goto(baseUrl);
      await page.getByRole('heading', { name: 'Sign in to FlyEye' }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(
        await page.evaluate(
          () =>
            document.fonts.check('600 40px Archivo') &&
            document.fonts.check('400 16px "IBM Plex Sans"'),
        ),
        true,
      );
      assertLayout(await inspectLayout(page), width);
      if (width === 390 || width === 1280) await capture(page, `after-${width}`);
    } finally {
      await page.close();
    }
  }

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let release = () => {};
  try {
    await mockSupabase(page, { invalid: true });
    let requests = 0;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/auth/v1/token?grant_type=password', async (route) => {
      requests += 1;
      await pending;
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error_code: 'invalid_credentials',
          msg: 'Invalid login credentials',
        }),
      });
    });
    await page.goto(baseUrl);
    const email = page.getByLabel('Email address'),
      password = page.getByLabel('Password', { exact: true });
    await email.waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await email.evaluate((element) => element === document.activeElement), true);
    assert.equal(await email.evaluate((element) => getComputedStyle(element).outlineWidth), '2px');
    for (const locator of [
      password,
      page.getByRole('button', { name: 'Show password' }),
      page.getByRole('button', { name: 'Sign in securely' }),
      page.getByRole('link', { name: 'Forgot password?' }),
    ]) {
      await page.keyboard.press('Tab');
      assert.equal(await locator.evaluate((element) => element === document.activeElement), true);
    }
    await page.getByRole('button', { name: 'Sign in securely' }).click();
    assert.equal(await email.getAttribute('aria-describedby'), 'email-error');
    assert.equal(await password.getAttribute('aria-describedby'), 'password-error');
    assert.equal(requests, 0);
    assertLayout(await inspectLayout(page), 390);
    await capture(page, 'validation-phone');
    await email.fill('student@example.test');
    await password.fill('SyntheticPassword1!');
    const passwordNode = await password.elementHandle();
    await page.getByRole('button', { name: 'Show password' }).click();
    assert.equal(await password.getAttribute('type'), 'text');
    await password.press('Enter');
    await page.getByRole('button', { name: 'Signing in…' }).waitFor();
    assert.equal(await email.isDisabled(), true);
    assert.equal(await password.isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Hide password' }).isDisabled(), true);
    await page.keyboard.press('Enter');
    await page.locator('button[type="submit"]').evaluate((button) => button.click());
    await capture(page, 'pending-phone');
    release();
    await page
      .getByRole('status')
      .filter({ hasText: 'The email or password is incorrect' })
      .waitFor();
    assert.equal(requests, 1);
    assert.equal(
      await passwordNode.evaluate((element) => element === document.querySelector('#password')),
      true,
    );
    assert.equal(await password.inputValue(), 'SyntheticPassword1!');
    assert.equal(await email.inputValue(), 'student@example.test');
    assertLayout(await inspectLayout(page), 390);
    await capture(page, 'rejected-phone');
    const cdp = await page.context().newCDPSession(page);
    const tree = await cdp.send('Accessibility.getFullAXTree');
    const nodes = tree.nodes.filter((node) => !node.ignored);
    assert.ok(
      nodes.some((node) => node.role.value === 'textbox' && node.name?.value === 'Email address'),
    );
    assert.ok(
      nodes.some(
        (node) =>
          node.role.value === 'status' &&
          node.properties?.some(
            (property) => property.name === 'live' && property.value.value === 'polite',
          ),
      ),
    );
    if (evidence)
      await fs.writeFile(
        path.join(evidence, 'accessibility-tree.json'),
        JSON.stringify(
          nodes.map((node) => ({
            role: node.role.value,
            name: node.name?.value,
            properties: node.properties,
          })),
          null,
          2,
        ),
      );
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await page.getByRole('heading', { name: 'Forgot your password?' }).waitFor();
    assert.equal(await page.locator('.auth-shell--password').count(), 0);
    await page.mouse.move(0, 0);
    assert.equal(
      await page
        .locator('.primary-button')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      'rgb(11, 52, 72)',
    );
  } finally {
    release();
    await page.close();
  }

  const fallback = await browser.newPage({ viewport: { width: 640, height: 450 } });
  try {
    await fallback.route('**/fonts/*.woff2', (route) => route.abort());
    await mockSupabase(fallback, {});
    await fallback.goto(baseUrl);
    await fallback.getByRole('heading', { name: 'Sign in to FlyEye' }).waitFor();
    await fallback.evaluate(() => document.fonts.ready);
    assert.equal(await fallback.evaluate(() => document.fonts.check('600 40px Archivo')), false);
    assertLayout(await inspectLayout(fallback), 640);
    await fallback.getByRole('button', { name: 'Sign in securely' }).scrollIntoViewIfNeeded();
    await capture(fallback, 'fallback-zoom-equivalent');
  } finally {
    await fallback.close();
  }
  const touch = await browser.newPage({
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
  });
  try {
    await mockSupabase(touch, { invalid: true });
    await touch.goto(baseUrl);
    await touch.getByLabel('Email address').waitFor();
    for (const viewport of [
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 390, height: 400 },
    ]) {
      await touch.setViewportSize(viewport);
      assertLayout(await inspectLayout(touch), viewport.width);
      const password = touch.getByLabel('Password', { exact: true });
      await password.tap();
      assert.equal(await password.evaluate((element) => element === document.activeElement), true);
      await touch.getByRole('button', { name: 'Sign in securely' }).tap();
      assert.equal(await password.getAttribute('aria-describedby'), 'password-error');
      await touch.getByRole('link', { name: 'Forgot password?' }).scrollIntoViewIfNeeded();
      const bounds = await touch.getByRole('link', { name: 'Forgot password?' }).boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1);
    }
    await capture(touch, 'touch-reduced-height');
  } finally {
    await touch.close();
  }
  process.stdout.write(
    'PASS sign-in foundation: six widths, keyboard, contrast/targets, validation/pending/rejection, recovery boundary, font fallback, zoom-equivalent reflow, tablet orientation and emulated touch/reduced-height reachability.\n',
  );
}
