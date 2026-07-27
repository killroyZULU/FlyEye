import { z } from 'zod';

export const RECOVERY_REQUEST_PATH = '/auth/forgot-password';
export const RECOVERY_COMPLETE_PATH = '/auth/recovery';
export const GENERIC_RECOVERY_ACKNOWLEDGEMENT =
  'If an eligible account matches that email, recovery instructions will be sent.';

const approvedLocalOrigins = new Set(['http://127.0.0.1:5173', 'http://127.0.0.1:4173']);

const recoveryCredentialSchema = z
  .string()
  .min(16)
  .max(2048)
  .refine((value) => !/\s/.test(value));

export const recoveryRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});

export const recoveredPasswordSchema = z
  .object({
    password: z.string().min(15).max(1024),
    confirmation: z.string().max(1024),
  })
  .refine((value) => value.password === value.confirmation, {
    message: 'Passwords do not match.',
    path: ['confirmation'],
  });

export type RecoveryRequest = z.infer<typeof recoveryRequestSchema>;
export type RecoveredPassword = z.infer<typeof recoveredPasswordSchema>;

export function approvedRecoveryRedirect(origin: string): string {
  if (!approvedLocalOrigins.has(origin)) {
    throw new Error('Password recovery is not configured for this environment.');
  }

  return `${origin}${RECOVERY_COMPLETE_PATH}`;
}

export function recoveryCredentialFromUrl(url: URL): string | null {
  if (url.pathname !== RECOVERY_COMPLETE_PATH) return null;
  if (url.hash !== '') return null;

  const tokenHashes = url.searchParams.getAll('token_hash');
  if (
    tokenHashes.length !== 1 ||
    [...url.searchParams.keys()].some((key) => key !== 'token_hash')
  ) {
    return null;
  }

  const parsed = recoveryCredentialSchema.safeParse(tokenHashes[0]);
  return parsed.success ? parsed.data : null;
}

export function scrubRecoveryCredential(history: History): void {
  history.replaceState(null, '', RECOVERY_COMPLETE_PATH);
}
