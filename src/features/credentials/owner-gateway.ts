import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/database.types';

export const syntheticSample =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQzlwPAAIGAUQpAeg+AAAAAElFTkSuQmCC';
const version = z.object({
  id: z.uuid(),
  state: z.enum(['pending', 'approved']),
  issueDate: z.iso.date(),
  expiryDate: z.iso.date().nullable(),
});
const completeness = z.enum(['approved', 'pending', 'required', 'not_yet_obtained', 'undeclared']);
const versions = z.object({
  elpCompleteness: completeness,
  ntcCompleteness: completeness,
  versions: z
    .array(
      z
        .discriminatedUnion('category', [
          version.extend({
            category: z.literal('mother_license'),
            licenseType: z.string(),
            licenseNumber: z.string(),
          }),
          version.extend({ category: z.literal('ntc'), noExpiry: z.boolean() }),
          version.extend({ category: z.literal('medical'), noExpiry: z.boolean() }),
          version.extend({
            category: z.literal('elp'),
            elpLevel: z.number().int().min(1).max(6),
            noExpiry: z.boolean(),
          }),
        ])
        .refine(
          (row) => row.category === 'mother_license' || row.noExpiry === (row.expiryDate === null),
        ),
    )
    .max(8),
  validUntil: z.iso.datetime({ offset: true }),
});
export type CredentialFields = {
  issueDate: string;
  expiryDate: string | null;
  noExpiry: boolean;
} & (
  | { licenseType: string; licenseNumber: string }
  | { category: 'elp'; elpLevel: number }
  | { category: 'ntc' | 'medical' }
);
export type Category = 'mother_license' | 'elp' | 'ntc' | 'medical';
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
    async declareNotObtained(scope: Scope, category: 'elp' | 'ntc', operationId: string) {
      const result = await client.functions.invoke('credential-owner', {
        body: { ...scope, action: 'declare_' + category, operationId },
      });
      if (result.error)
        throw new Error('Refresh My Credentials to check the current credential status.');
      z.object({ [category + 'Completeness']: z.literal('not_yet_obtained') }).parse(result.data);
    },
    async withdrawal(
      scope: Scope,
      action: 'withdraw' | 'withdraw_outcome',
      versionId: string,
      operationId: string,
      category?: Category,
    ) {
      const result = await client.functions.invoke('credential-owner', {
        body: {
          ...scope,
          action,
          versionId,
          operationId,
          ...(category && category !== 'mother_license' && { category }),
        },
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
      fields: CredentialFields,
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
    async reconcile(
      scope: Scope,
      operationId: string,
      expectedPendingId?: string,
      category?: Category,
    ) {
      const result = await invoke({
        ...scope,
        action: 'reconcile',
        category: category === 'mother_license' ? undefined : category,
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
