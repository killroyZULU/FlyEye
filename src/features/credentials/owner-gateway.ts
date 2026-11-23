import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/database.types';

export const syntheticSample =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQzlwPAAIGAUQpAeg+AAAAAElFTkSuQmCC';
const versions = z.object({
  versions: z
    .array(
      z.object({
        id: z.uuid(),
        state: z.enum(['pending', 'approved']),
        licenseType: z.string(),
        licenseNumber: z.string(),
        issueDate: z.iso.date(),
        expiryDate: z.iso.date().nullable(),
      }),
    )
    .max(2),
  validUntil: z.iso.datetime({ offset: true }),
});
type Scope = { organizationId: string; membershipId: string };
export type OwnerGateway = ReturnType<typeof createOwnerGateway>;
export function createOwnerGateway(client: Pick<SupabaseClient<Database>, 'functions'>) {
  async function invoke(body: Record<string, unknown>) {
    const result = await client.functions.invoke('credential-owner', { body });
    if (result.error)
      throw new Error(
        result.response?.status === 409
          ? body.action === 'replace'
            ? 'The pending version changed or the request conflicted. Refresh before replacing it.'
            : 'A pending submission already exists. Refresh to see it.'
          : 'The request could not be confirmed. Check your session and refresh My Credentials.',
      );
    return result;
  }
  return {
    async status(scope: Scope) {
      return versions.parse((await invoke({ ...scope, action: 'status' })).data);
    },
    async withdrawal(
      scope: Scope,
      action: 'withdraw' | 'withdraw_outcome',
      versionId: string,
      operationId: string,
    ) {
      const result = await client.functions.invoke('credential-owner', {
        body: { ...scope, action, versionId, operationId },
      });
      if (result.error) {
        if (result.response?.status === 409) return 'conflict' as const;
        throw new Error('Withdrawal could not be confirmed. Check its outcome.');
      }
      const response = z
        .object({ id: z.literal(versionId), state: z.enum(['withdrawn', 'unconfirmed']) })
        .parse(result.data);
      if (action === 'withdraw' && response.state !== 'withdrawn')
        throw new Error('Check the withdrawal outcome.');
      return response.state;
    },
    async submit(
      scope: Scope,
      fields: {
        licenseType: string;
        licenseNumber: string;
        issueDate: string;
        expiryDate: string | null;
        noExpiry: boolean;
      },
      file: File,
      operationId: string,
      expectedPendingId?: string,
    ) {
      if (file.size !== 69) throw new Error('Choose the provided synthetic PNG.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await invoke({
        ...scope,
        ...fields,
        ...(expectedPendingId ? { action: 'replace', expectedPendingId } : { action: 'submit' }),
        operationId,
        filename: file.name,
        mime: file.type,
        file: btoa(String.fromCharCode(...bytes)),
      });
      return z.object({ state: z.literal('pending'), id: z.uuid() }).parse(result.data);
    },
    async reconcile(scope: Scope, operationId: string, expectedPendingId?: string) {
      const result = await invoke({
        ...scope,
        action: 'reconcile',
        operationId,
        expectedPendingId,
      });
      return z
        .discriminatedUnion('state', [
          z.object({ state: z.literal('unconfirmed') }),
          z.object({ state: z.literal('pending'), id: z.uuid() }),
          z.object({ state: z.literal('withdrawn'), id: z.uuid() }),
        ])
        .parse(result.data);
    },
    async evidence(scope: Scope, versionId: string) {
      const result = await invoke({ ...scope, action: 'evidence', versionId });
      if (!(result.data instanceof Blob) || result.data.size !== 69)
        throw new Error('Evidence unavailable.');
      const until = z.iso
        .datetime({ offset: true })
        .parse(result.response?.headers.get('X-Credential-Until'));
      return { blob: new Blob([result.data], { type: 'image/png' }), until };
    },
  };
}
