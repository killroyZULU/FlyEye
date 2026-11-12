import { requireFeat003ReviewedStagingManifest } from './feat-003-staging-manifest.mjs';

const expected = Object.freeze({
  schemaVersion: 1,
  policy: 'no-send-v1',
  signupEnabled: false,
  emailPasswordEnabled: true,
  totpEnrollEnabled: true,
  totpVerifyEnabled: true,
  emailHookEnabled: true,
  emailHookUri: 'pg-functions://postgres/staging_private/reject_email',
  securityNotificationsEnabled: false,
  externalProvidersEnabled: false,
  smsEnabled: false,
  customSmtpEnabled: false,
});

// Offline consistency only: P4 must independently read back actual provider settings.
export function validateStagingNoSend(manifestText, configurationText) {
  try {
    if (typeof manifestText !== 'string' || manifestText.length > 16384) throw new Error();
    requireFeat003ReviewedStagingManifest(JSON.parse(manifestText));
    if (typeof configurationText !== 'string' || configurationText.length > 16384)
      throw new Error();
    const configuration = JSON.parse(configurationText);
    if (
      !configuration ||
      Object.keys(configuration).length !== Object.keys(expected).length ||
      !Object.entries(expected).every(([key, value]) => configuration[key] === value)
    )
      throw new Error();
    return Object.freeze({ policy: expected.policy, executionAuthorized: false });
  } catch {
    throw new Error('FEAT-003 staging no-send configuration rejected.');
  }
}
