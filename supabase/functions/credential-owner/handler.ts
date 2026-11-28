import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  authenticationEvidenceFromVerifiedToken,
  passwordAuthenticationIsPresent,
} from '../_shared/authentication-evidence.ts';

import {
  attachment,
  selectEvidence,
  maxRequestBytes,
  verifiedBytes,
  stageEvidence,
} from './files.ts';
const scope = z.object({ organizationId: z.uuid(), membershipId: z.uuid() });
const day = z.iso.date();
const license = scope
  .extend({
    operationId: z.uuid(),
    licenseType: z.enum(['SPL', 'PPL', 'CPL', 'ATPL']),
    licenseNumber: z
      .string()
      .regex(/^[^\p{Cc}]+$/u)
      .trim()
      .min(1)
      .max(80),
    issueDate: day,
    expiryDate: day.nullable(),
    noExpiry: z.boolean(),
    filename: attachment.shape.filename.optional(),
    mime: z.literal('image/png').optional(),
    file: z.string().optional(),
    files: z.array(attachment).min(1).max(2).optional(),
  })
  .strict();
const dated = license.omit({ licenseType: true, licenseNumber: true });
const certificate = dated.extend({ category: z.enum(['medical', 'fi', 'gi']) });
const ntc = dated.extend({ category: z.literal('ntc') });
const elp = dated.extend({ category: z.literal('elp'), elpLevel: z.number().int().min(1).max(6) });
const withdrawal = scope
  .extend({
    category: z.enum(['elp', 'ntc', 'medical', 'fi', 'gi']).optional(),
    versionId: z.uuid(),
    operationId: z.uuid(),
  })
  .strict();
const input = z.union([
  scope.extend({ action: z.literal('declare_ntc'), operationId: z.uuid() }).strict(),
  scope.extend({ action: z.literal('declare_elp'), operationId: z.uuid() }).strict(),
  scope.extend({ action: z.literal('status') }).strict(),
  withdrawal.extend({ action: z.literal('withdraw') }),
  withdrawal.extend({ action: z.literal('withdraw_outcome') }),
  scope
    .extend({
      action: z.literal('evidence'),
      versionId: z.uuid(),
      slot: z.number().int().min(0).max(1).optional(),
    })
    .strict(),
  scope
    .extend({
      action: z.literal('reconcile'),
      category: z.enum(['elp', 'ntc', 'medical', 'fi', 'gi']).optional(),
      operationId: z.uuid(),
      expectedPendingId: z.uuid().optional(),
    })
    .strict(),
  certificate.extend({ action: z.literal('submit') }),
  certificate.extend({ action: z.literal('replace'), expectedPendingId: z.uuid() }),
  license.extend({ action: z.literal('submit') }),
  elp.extend({ action: z.literal('submit') }),
  ntc.extend({ action: z.literal('submit') }),
  ntc.extend({ action: z.literal('replace'), expectedPendingId: z.uuid() }),
  elp.extend({ action: z.literal('replace'), expectedPendingId: z.uuid() }),
  license.extend({ action: z.literal('replace'), expectedPendingId: z.uuid() }),
]);
type Submission = Extract<z.infer<typeof input>, { action: 'submit' | 'replace' }>;
function categoryFields(data: Submission) {
  if ('licenseType' in data)
    return { licenseType: data.licenseType, licenseNumber: data.licenseNumber };
  if (data.category === 'elp') return { category: data.category, elpLevel: data.elpLevel };
  return { category: data.category };
}
export function passwordActor(token: string, userId: string) {
  const evidence = authenticationEvidenceFromVerifiedToken(token, userId);
  if (!passwordAuthenticationIsPresent(evidence)) return null;
  const segment = token.split('.')[1];
  if (!segment) return null;
  const { exp: expiration } = z
    .object({ exp: z.number().int().positive() })
    .parse(JSON.parse(atob(segment.replaceAll('-', '+').replaceAll('_', '/'))));
  return {
    p_actor: evidence.actorUserId,
    p_session: evidence.sessionId,
    p_token_exp: expiration,
    p_mfa: evidence.assuranceLevel === 'aal2' && evidence.totpAuthenticatedAt !== null,
  };
}
function validDates(data: Pick<z.infer<typeof license>, 'issueDate' | 'expiryDate' | 'noExpiry'>) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return (
    data.issueDate <= today &&
    data.noExpiry === (data.expiryDate === null) &&
    (data.expiryDate === null || data.expiryDate >= data.issueDate)
  );
}
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0,
    text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maxRequestBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return input.parse(JSON.parse(text + decoder.decode()));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
const resultSchema = z
  .object({
    key: z.string().optional(),
    keys: z.array(z.string()).optional(),
    mime: z.enum(['image/png', 'image/jpeg', 'application/pdf']).optional(),
    size: z.number().int().positive().max(10_000_000).optional(),
    id: z.uuid().optional(),
    state: z.string().optional(),
    rolledBack: z.boolean().optional(),
    replayed: z.boolean().optional(),
    conflict: z.boolean().optional(),
    digest: z.string().optional(),
    validUntil: z.string().optional(),
  })
  .passthrough()
  .nullable();
type Config = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseServiceRoleKey: string;
  allowedOrigin: string;
};
export function credentialOwnerHandler(config: Config) {
  if (
    !/^http:\/\/(?:127\.0\.0\.1|localhost|kong):\d+$/.test(config.supabaseUrl) ||
    !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(config.allowedOrigin)
  )
    throw new Error('Local configuration required.');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const auth = createClient(config.supabaseUrl, config.supabasePublishableKey, options).auth;
  const server = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, options);
  const store = server.storage.from('credential-synthetic');
  return async (request: Request) => {
    const headers = {
      'Access-Control-Allow-Origin': config.allowedOrigin,
      Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    const reply = (status: number, data: unknown = null) =>
      Response.json(data, { status, headers });
    if (request.headers.get('Origin') !== config.allowedOrigin) return reply(403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405);
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
      return reply(415);
    const token = /^Bearer (\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!token) return reply(401);
    try {
      const verify = async () => {
        const { data, error } = await auth.getUser(token);
        if (error || !data.user) return null;
        return passwordActor(token, data.user.id);
      };
      const actor = await verify();
      if (!actor) return reply(401);
      const data = await body(request);
      if (!data) return reply(400);
      const guard = async (denial: boolean) => {
        const { data: allowed, error } = await server
          .rpc('credential_request_guard', {
            p_actor: actor.p_actor,
            p_action: data.action,
            p_denial: denial,
          })
          .returns<unknown>();
        if (error || typeof allowed !== 'boolean') throw new Error('Guard unavailable.');
        return allowed;
      };
      if (!(await guard(false)))
        return Response.json(null, { status: 429, headers: { ...headers, 'Retry-After': '60' } });
      const denied = async () => {
        if (!(await guard(true))) throw new Error('Audit unavailable.');
        return reply(403);
      };
      const call = async (
        action: string,
        id: string | null,
        details: Record<string, unknown> | null = null,
      ) => {
        const { error, data: result } = await server
          .rpc('credential_owner_submission', {
            ...actor,
            p_school: data.organizationId,
            p_member: data.membershipId,
            p_action: action,
            p_version: id,
            p_details: details,
          })
          .returns<unknown>();
        if (error) throw new Error('Protected operation unavailable.');
        return resultSchema.parse(result);
      };
      async function serveEvidence(data: Extract<z.infer<typeof input>, { action: 'evidence' }>) {
        const selection = data.slot === undefined ? null : { slot: data.slot };
        const result = await call('locate', data.versionId, selection);
        if (!result?.key) return await denied();
        const file = await store.download(result.key);
        if (file.error || !file.data) return reply(503);
        const bytes = await verifiedBytes(file.data, result);
        if (!bytes) return reply(503);
        const mime = result.mime ?? 'image/png';
        if (!(await verify())) return await denied();
        const served = await call('serve', data.versionId, selection);
        if (served?.key !== result.key || served.digest !== result.digest || !served.validUntil)
          return await denied();
        return new Response(bytes, {
          headers: {
            ...headers,
            'Content-Type': 'application/octet-stream',
            'Access-Control-Expose-Headers': 'X-Credential-Until, X-Credential-Type',
            'X-Credential-Type': mime,
            'X-Credential-Until': served.validUntil,
            'Content-Disposition':
              mime === 'application/pdf' ? 'attachment; filename="credential.pdf"' : 'inline',
          },
        });
      }
      async function submitLicense(data: Submission) {
        if (!validDates(data)) return reply(400);
        const id = crypto.randomUUID();
        const parts = await selectEvidence(data);
        if (!parts) return reply(400);
        const details = submissionDetails(data, parts);
        const ready = await call('prepare', id, details);
        if (ready?.replayed) return reply(200, { id: ready.id, state: ready.state });
        if (ready?.conflict) return reply(409);
        if (!ready?.key) return await denied();
        const uploaded = await stageEvidence(store, ready, parts, !!data.files);
        if (!uploaded) return reply(503);
        // Only remove this fresh attempt's object on a definitive refusal. A lost commit
        // acknowledgement leaves private bytes for reconciliation, never blind deletion.
        if (!(await verify())) {
          await store.remove(uploaded);
          return await denied();
        }
        const result = await call('commit', id, details);
        if (result?.rolledBack) {
          await store.remove(uploaded);
          return reply(503);
        }
        if (result?.replayed) {
          await store.remove(uploaded);
          return reply(200, { id: result.id, state: result.state });
        }
        if (!result || result.conflict) {
          await store.remove(uploaded);
          return result?.conflict ? reply(409) : await denied();
        }
        return reply(201, result);
      }
      async function declare(action: 'declare_elp' | 'declare_ntc', operationId: string) {
        const key = action === 'declare_ntc' ? 'ntcCompleteness' : 'elpCompleteness';
        const result = await call(action, null, { operationId });
        if (!result) return denied();
        if (result.conflict) return reply(409);
        return result[key] === 'not_yet_obtained' ? reply(200, { [key]: result[key] }) : reply(503);
      }
      const dispatch = async () => {
        if (data.action === 'status') {
          const result = await call('status', null);
          return result ? reply(200, result) : await denied();
        }
        if (!actor.p_mfa) return await denied();
        if (data.action === 'declare_elp' || data.action === 'declare_ntc')
          return declare(data.action, data.operationId);
        if (data.action === 'withdraw' || data.action === 'withdraw_outcome') {
          const result = await call(data.action, data.versionId, {
            operationId: data.operationId,
            category: data.category,
          });
          if (!result) return await denied();
          if (result.conflict) return reply(409);
          if (
            result.id !== data.versionId ||
            (result.state !== 'withdrawn' &&
              !(data.action === 'withdraw_outcome' && result.state === 'unconfirmed'))
          )
            return reply(503);
          return reply(200, { id: result.id, state: result.state });
        }
        if (data.action === 'reconcile') {
          const result = await call('reconcile', null, {
            category: data.category,
            operationId: data.operationId,
            expectedPendingId: data.expectedPendingId,
          });
          if (result?.conflict) return reply(409);
          return result ? reply(200, result) : await denied();
        }
        return data.action === 'evidence' ? await serveEvidence(data) : await submitLicense(data);
      };
      return await dispatch();
    } catch {
      return reply(503);
    }
  };
}

function submissionDetails(
  data: Submission,
  parts: NonNullable<Awaited<ReturnType<typeof selectEvidence>>>,
) {
  return {
    ...(data.action === 'replace' ? { expectedPendingId: data.expectedPendingId } : {}),
    operationId: data.operationId,
    ...categoryFields(data),
    issueDate: data.issueDate,
    expiryDate: data.expiryDate,
    noExpiry: data.noExpiry,
    digest: parts[0]!.digest,
    ...(data.files && {
      evidenceManifest: parts.map(({ mime, size, digest }) => ({ mime, size, digest })),
    }),
  };
}
