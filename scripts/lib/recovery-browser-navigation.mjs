import assert from 'node:assert/strict';

const recoveryUrl =
  'http://127.0.0.1:4173/auth/recovery?token_hash=synthetic-recovery-token-hash-1234567890';

async function assertUnavailable(page) {
  await page.getByRole('heading', { name: 'This link cannot be used' }).waitFor();
  assert.equal(new URL(page.url()).search, '');
  assert.equal(await page.getByLabel('New password', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'Your password has changed' }).count(), 0);
}

export async function checkUnverifiedRecoveryNavigation(page) {
  let verifications = 0;
  const countVerification = (request) => {
    if (new URL(request.url()).pathname === '/auth/v1/verify') verifications += 1;
  };
  page.on('request', countVerification);
  try {
    await page.goto(recoveryUrl);
    await page.getByRole('heading', { name: 'Continue password recovery?' }).waitFor();
    assert.equal(new URL(page.url()).search, '');
    await page.reload();
    await assertUnavailable(page);
    await page.goto(recoveryUrl);
    await page.getByRole('heading', { name: 'Continue password recovery?' }).waitFor();
    await page.getByRole('link', { name: 'Cancel and return to sign in' }).click();
    await page.getByRole('button', { name: 'Sign in securely' }).waitFor();
    await page.goBack();
    await assertUnavailable(page);
    assert.equal(verifications, 0);
  } finally {
    page.off('request', countVerification);
  }
}

export async function checkCompletedRecoveryNavigation(page) {
  let mutations = 0;
  const countMutation = (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname === '/auth/v1/verify' ||
      (pathname === '/auth/v1/user' && request.method() === 'PUT')
    ) {
      mutations += 1;
    }
  };
  page.on('request', countMutation);
  try {
    await page.getByRole('link', { name: 'Continue to sign in' }).click();
    await page.getByRole('button', { name: 'Sign in securely' }).waitFor();
    await page.goBack();
    await assertUnavailable(page);
    await page.reload();
    await assertUnavailable(page);
    assert.equal(mutations, 0);
  } finally {
    page.off('request', countMutation);
  }
}
