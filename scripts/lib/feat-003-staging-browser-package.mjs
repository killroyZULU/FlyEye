import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { feat003StagingTarget as target } from '../../config/feat-003-staging-target.mjs';

const recoveryPath = '/auth/recovery';
const selectionSchema = z.strictObject({
  publishableKey: z
    .string()
    .max(256)
    .regex(/^sb_publishable_[A-Za-z0-9_-]+$/u),
  callbackPaths: z.union([z.tuple([]), z.tuple([z.literal(recoveryPath)])]),
});
const reject = () => {
  throw new Error('Invalid staging browser configuration.');
};

// selection is the independently reviewed public input. It is never inferred
// from the candidate or the shell. Selecting recovery does not enable Auth mail.
export function generateStagingBrowserConfiguration(selection) {
  const selected = selectionSchema.safeParse(selection);
  if (!selected.success) reject();
  return Buffer.from(
    JSON.stringify({
      siteUrl: target.frontendOrigin,
      corsOrigins: [target.frontendOrigin],
      redirectUrls: selected.data.callbackPaths.map((path) => target.frontendOrigin + path),
      frontendEnv: {
        VITE_SUPABASE_URL: target.apiOrigin,
        VITE_SUPABASE_PUBLISHABLE_KEY: selected.data.publishableKey,
      },
    }),
    'utf8',
  );
}

// Reject substitutions before providing any values to Vite.
export function readStagingBrowserConfiguration(candidateText, selection) {
  const expected = JSON.parse(generateStagingBrowserConfiguration(selection));
  if (typeof candidateText !== 'string' || candidateText.length > 65536) reject();
  try {
    if (isDeepStrictEqual(JSON.parse(candidateText), expected)) return expected;
  } catch {
    // Keep malformed input and key material out of diagnostics.
  }
  reject();
}
