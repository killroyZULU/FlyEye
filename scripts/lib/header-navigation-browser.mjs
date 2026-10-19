/* global document, getComputedStyle -- Used only inside browser-evaluated callbacks. */
import assert from 'node:assert/strict';

async function layout(page, width) {
  const result = await page.evaluate(() => {
    const header = document.querySelector('.application-header');
    const nav = document.querySelector('.primary-navigation');
    const contrast = (first, second) => {
      const luminance = (color) =>
        color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4))
          .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
      const a = luminance(first),
        b = luminance(second);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const pairs = [
      ...document.querySelectorAll(
        '.application-header strong, .application-header small, .school-context span, .account-context > span, .application-header button, .primary-navigation button',
      ),
    ]
      .filter((e) => e.getClientRects().length)
      .map((e) => {
        let parent = e,
          background = getComputedStyle(e).backgroundColor;
        while (background === 'rgba(0, 0, 0, 0)' && parent.parentElement) {
          parent = parent.parentElement;
          background = getComputedStyle(parent).backgroundColor;
        }
        return {
          text: e.textContent.trim(),
          ratio: contrast(getComputedStyle(e).color, background),
        };
      });
    const targets = [
      ...document.querySelectorAll('.application-header button, .primary-navigation button'),
    ].map((e) => {
      const r = e.getBoundingClientRect();
      return { name: e.textContent.trim(), width: r.width, height: r.height };
    });
    const school = document.querySelector('.school-context strong');
    const role = document.querySelector('.account-context > span');
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      targets,
      pairs,
      schoolFits: school.scrollWidth <= school.clientWidth,
      roleVisible: role.getBoundingClientRect().height > 0,
      headerFont: getComputedStyle(header).fontFamily,
      headerBackground: getComputedStyle(header).backgroundColor,
      navBackground: getComputedStyle(nav).backgroundColor,
      isolated: ['.application-main', '.application-footer'].every((selector) => {
        const style = getComputedStyle(document.querySelector(selector));
        return (
          style.getPropertyValue('--font-body') === '' &&
          style.fontFamily === getComputedStyle(document.documentElement).fontFamily
        );
      }),
    };
  });
  assert.equal(result.overflow, false, `No horizontal page overflow at ${width}`);
  assert.equal(result.schoolFits, true, `School name fits at ${width}`);
  assert.equal(result.roleVisible, true, `Role visible at ${width}`);
  assert.equal(result.isolated, true, 'Foundation inheritance stops before module content/footer');
  assert.match(result.headerFont, /IBM Plex Sans/);
  assert.equal(result.headerBackground, 'rgb(14, 34, 70)');
  assert.equal(result.navBackground, 'rgb(255, 255, 255)');
  for (const target of result.targets)
    assert.ok(target.width >= 44 && target.height >= 44, `${target.name} target at ${width}`);
  for (const pair of result.pairs)
    assert.ok(pair.ratio >= 4.5, `${pair.text} contrast at ${width}`);
}

async function focusedAndReachable(locator) {
  assert.equal(await locator.evaluate((e) => e === document.activeElement), true);
  assert.equal(await locator.evaluate((e) => getComputedStyle(e).outlineWidth), '2px');
  const visible = await locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    const container = e.closest('.primary-navigation__inner')?.getBoundingClientRect();
    return (
      r.left >= (container?.left ?? 0) - 1 &&
      r.right <= (container?.right ?? document.documentElement.clientWidth) + 1
    );
  });
  assert.equal(visible, true, 'Focused control is reachable without clipping');
}

export async function checkHeaderNavigation(browser, mockSupabase, submitLogin, contexts) {
  const start = async (page, context) => {
    await mockSupabase(page, { context });
    await page.goto('http://127.0.0.1:4173');
    await submitLogin(page);
    await page.getByRole('navigation', { name: 'Primary navigation' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
  };
  const adminNames = [
    'Home',
    'Aircraft',
    'Aircraft documents',
    'Invitations',
    'People',
    'My profile',
    'Account security',
  ];
  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      const context = structuredClone(contexts.admin);
      context.memberships[0].organizationName =
        'Synthetic Flight School for Professional Aviation Training and Instruction — Long Name Verification';
      await start(page, context);
      await layout(page, width);
      assert.deepEqual(
        await page.locator('.primary-navigation button').allTextContents(),
        adminNames,
      );
      const skip = page.getByRole('link', { name: 'Skip to workspace content' });
      await page.keyboard.press('Tab');
      await skip.focus();
      await focusedAndReachable(skip);
      await page.keyboard.press('Enter');
      assert.equal(
        await page.getByRole('main').evaluate((e) => e === document.activeElement),
        true,
      );
      await skip.focus();
      await page.keyboard.press('Tab');
      await focusedAndReachable(page.getByRole('button', { name: 'Sign out', exact: true }));
      for (const name of adminNames) {
        await page.keyboard.press('Tab');
        await focusedAndReachable(
          page.getByRole('navigation').getByRole('button', { name, exact: true }),
        );
      }
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'My profile', exact: true })
        .click();
      const field = page.getByLabel('Display name', { exact: true });
      await field.waitFor();
      await field.fill('Synthetic unsaved profile');
      const input = await field.elementHandle();
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'My profile', exact: true })
        .dblclick();
      assert.equal(await field.inputValue(), 'Synthetic unsaved profile');
      assert.equal(await input.evaluate((e) => e.isConnected), true);
      assert.equal(await page.locator('[aria-current="page"]').count(), 1);
      assert.equal(await page.locator('[aria-current="page"]').textContent(), 'My profile');
      await page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true }).click();
      assert.equal(
        await page.getByRole('main').evaluate((e) => e === document.activeElement),
        true,
      );
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('heading', { name: 'Sign in to FlyEye' }).waitFor();
      assert.equal(await page.locator('.application-header').count(), 0);
    } finally {
      await page.close();
    }
  }

  const instructor = structuredClone(contexts.student);
  Object.assign(instructor.memberships[0], {
    role: 'instructor_pilot',
    roleLabel: 'Instructor Pilot',
    workspacePermission: 'portal.instructor.access',
    permissions: ['portal.instructor.access', 'aircraft.document.status.read'],
    requiredAssuranceLevel: 'aal2',
  });
  instructor.currentAssuranceLevel = 'aal2';
  const restricted = structuredClone(contexts.admin);
  restricted.memberships[0].permissions = ['portal.admin.access'];
  for (const [context, names] of [
    [contexts.student, ['Home', 'Aircraft documents', 'My profile', 'Account security']],
    [instructor, ['Home', 'Aircraft documents', 'My profile', 'Account security']],
    [restricted, ['Home', 'My profile', 'Account security']],
  ]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await start(page, context);
      assert.deepEqual(await page.locator('.primary-navigation button').allTextContents(), names);
      await layout(page, 390);
      const cdp = await page.context().newCDPSession(page);
      const tree = await cdp.send('Accessibility.getFullAXTree');
      assert.ok(
        tree.nodes.some(
          (n) =>
            !n.ignored && n.role.value === 'navigation' && n.name?.value === 'Primary navigation',
        ),
      );
      assert.ok(
        tree.nodes.some(
          (n) => !n.ignored && n.role.value === 'button' && n.name?.value === 'Sign out',
        ),
      );
    } finally {
      await page.close();
    }
  }

  const touch = await browser.newPage({ viewport: { width: 768, height: 1024 }, hasTouch: true });
  try {
    await touch.route('**/fonts/*.woff2', (route) => route.abort());
    await start(touch, contexts.admin);
    assert.equal(
      await touch.evaluate(() => document.fonts.check('400 16px "IBM Plex Sans"')),
      false,
    );
    for (const viewport of [
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 390, height: 400 },
    ]) {
      await touch.setViewportSize(viewport);
      await layout(touch, viewport.width);
      const profile = touch
        .getByRole('navigation')
        .getByRole('button', { name: 'My profile', exact: true });
      await profile.tap();
      await touch.getByLabel('Display name', { exact: true }).waitFor();
      await touch.getByRole('navigation').getByRole('button', { name: 'Home', exact: true }).tap();
      await touch.getByRole('button', { name: 'Sign out', exact: true }).scrollIntoViewIfNeeded();
      const bounds = await touch
        .getByRole('button', { name: 'Sign out', exact: true })
        .boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1);
    }
  } finally {
    await touch.close();
  }
  process.stdout.write(
    'PASS header/navigation: six widths, exact role/permission destinations, long names, contrast/targets, keyboard/focus, repeated navigation and unsaved input, sign-out, scoped inheritance, accessibility tree, font fallback and emulated touch/orientation/reduced-height reachability.\n',
  );
}
