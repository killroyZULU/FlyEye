import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { authenticationEvidenceFromVerifiedToken } from '../_shared/authentication-evidence.ts';
import { createAircraftDocumentHandler } from './handler.ts';
import { readAircraftDocumentRuntimeConfiguration } from './runtime-config.ts';

const configuration = readAircraftDocumentRuntimeConfiguration((name) => Deno.env.get(name));
const publicClient = createClient(configuration.supabaseUrl, configuration.supabasePublishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const serverClient = createClient(configuration.supabaseUrl, configuration.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const hmacKey = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(configuration.limiterSecret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);
const limiterSchema = z
  .object({
    allowed: z.boolean(),
    retryAfterSeconds: z.number().int().min(1).max(3600).nullable(),
    correlationId: z.uuid(),
    policyVersion: z.literal('aircraft-documents-v1'),
  })
  .strict();

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sign(value: string): Promise<string> {
  return hex(
    new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(value))),
  );
}

async function rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await serverClient.rpc(name, parameters);
  if (error?.code === 'P7101') {
    const auditError = new Error('Aircraft document audit failed.');
    auditError.name = 'AircraftDocumentAuditError';
    throw auditError;
  }
  if (error) throw error;
  return data;
}

Deno.serve(
  createAircraftDocumentHandler({
    allowedOrigin: configuration.allowedOrigin,
    authenticate: async (accessToken) => {
      const { data, error } = await publicClient.auth.getUser(accessToken);
      if (error || !data.user) throw new Error('Authentication failed.');
      return authenticationEvidenceFromVerifiedToken(accessToken, data.user.id);
    },
    resolveContext: (actorUserId) =>
      rpc('resolve_aircraft_document_context', { p_actor_user_id: actorUserId }),
    limiterKey: (actorSubjectId, organizationId) =>
      sign(`${actorSubjectId}\u0000${organizationId}\u0000aircraft-documents-v1`),
    consumeLimit: ({ limiterKeyHash, bucket, correlationId }) =>
      rpc('consume_aircraft_document_rate_limit', {
        p_limiter_key_hash: limiterKeyHash,
        p_bucket: bucket,
        p_correlation_id: correlationId,
      }).then((value) => limiterSchema.parse(value)),
    recordSecurity: ({ actorUserId, organizationId, action, outcome, reason, correlationId }) =>
      rpc('record_aircraft_document_security_event', {
        p_actor_user_id: actorUserId,
        p_organization_id: organizationId,
        p_action: action,
        p_outcome: outcome,
        p_reason: reason,
        p_correlation_id: correlationId,
      }).then(() => undefined),
    rpc,
    createSignedUpload: async (objectKey) => {
      const { data, error } = await serverClient.storage
        .from('aircraft-documents')
        .createSignedUploadUrl(objectKey);
      if (error || !data) throw error ?? new Error('Signed upload unavailable.');
      return { token: data.token, path: data.path };
    },
    downloadStagedFile: async (objectKey) => {
      const { data, error } = await serverClient.storage
        .from('aircraft-documents')
        .download(objectKey);
      if (error || !data) throw error ?? new Error('Staged file unavailable.');
      return new Uint8Array(await data.arrayBuffer());
    },
    createSignedDownload: async (objectKey, downloadName) => {
      const { data, error } = await serverClient.storage
        .from('aircraft-documents')
        .createSignedUrl(objectKey, 60, { download: downloadName });
      if (error || !data?.signedUrl) throw error ?? new Error('Signed download unavailable.');
      const signed = new URL(data.signedUrl);
      return `${configuration.publicSupabaseUrl}${signed.pathname}${signed.search}`;
    },
  }),
);
