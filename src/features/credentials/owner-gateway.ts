import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/database.types';

import { syntheticSamples } from './synthetic-samples.ts';
export const syntheticSample = syntheticSamples[0].data;
export { syntheticSamples };
export type EvidenceType = (typeof syntheticSamples)[number]['mime'];
const version = z.object({
  id: z.uuid(),
  evidenceTypes: z
    .array(z.enum(['image/jpeg', 'image/png', 'application/pdf']))
    .min(1)
    .max(2)
    .optional(),
  state: z.enum(['pending', 'approved']),
  issueDate: z.iso.date(),
  expiryDate: z.iso.date().nullable(),
});
const completeness = z.enum(['approved', 'pending', 'required', 'not_yet_obtained', 'undeclared']);
const versions = z.object({
  elpCompleteness: completeness,
  ntcCompleteness: completeness,
  instructorApplicable: z.boolean().optional(),
  instructorHistory: z.array(z.enum(['fi', 'gi'])).optional(),
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
          version.extend({ category: z.enum(['medical', 'fi', 'gi']), noExpiry: z.boolean() }),
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
    .max(12),
  validUntil: z.iso.datetime({ offset: true }),
});
export type CredentialFields = {
  issueDate: string;
  expiryDate: string | null;
  noExpiry: boolean;
} & (
  | { licenseType: string; licenseNumber: string }
  | { category: 'elp'; elpLevel: number }
  | { category: 'ntc' | 'medical' | 'fi' | 'gi' }
);
export type Category = 'mother_license' | 'elp' | 'ntc' | 'medical' | 'fi' | 'gi';
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
      file: File | File[],
      operationId: string,
      expectedPendingId?: string,
    ) {
      const entries = Array.isArray(file) ? file : [file];
      if (
        entries.length < 1 ||
        entries.length > 2 ||
        (entries.length > 1 && entries.some((f) => f.type === 'application/pdf'))
      )
        throw new Error('Choose one PDF or one or two images.');
      const files = await Promise.all(
        entries.map(async (f) => {
          if (f.size < 1 || f.size > 10_000_000 || !syntheticSamples.some((s) => s.mime === f.type))
            throw new Error('Choose the provided synthetic samples.');
          return {
            filename: f.name,
            mime: f.type,
            file: await fileBase64(f),
          };
        }),
      );
      const first = files[0]!;
      const result = await invoke({
        ...scope,
        ...fields,
        ...(expectedPendingId ? { action: 'replace', expectedPendingId } : { action: 'submit' }),
        operationId,
        ...(files.length === 1 && first.file === syntheticSample && first.mime === 'image/png'
          ? first
          : { files }),
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
    async evidence(
      scope: Scope,
      versionId: string,
      slot?: number,
      type: EvidenceType = 'image/png',
    ) {
      const result = await invoke({
        ...scope,
        action: 'evidence',
        versionId,
        ...(slot === undefined ? {} : { slot }),
      });
      const blob: unknown = result.data;
      if (
        !(blob instanceof Blob) ||
        blob.size < 1 ||
        blob.size > 10_000_000 ||
        (result.response?.headers.get('X-Credential-Type') ?? 'image/png') !== type
      )
        throw new Error('Evidence unavailable.');
      const until = z.iso
        .datetime({ offset: true })
        .parse(result.response?.headers.get('X-Credential-Until'));
      return { blob: new Blob([blob], { type }), until };
    },
  };
}

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks: string[] = [];
  // Keep each chunk aligned on base64 triples.
  for (let i = 0; i < bytes.length; i += 24576)
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 24576))));
  return chunks.join('');
}
