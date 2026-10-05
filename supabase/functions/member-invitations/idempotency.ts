import type { MemberInvitationDependencies } from './contracts.ts';

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function finalizeWithReadBack(
  dependencies: MemberInvitationDependencies,
  input: Parameters<MemberInvitationDependencies['finalizeDelivery']>[0],
): Promise<unknown> {
  try {
    return await dependencies.finalizeDelivery(input);
  } catch {
    return await dependencies.finalizeDelivery(input);
  }
}
