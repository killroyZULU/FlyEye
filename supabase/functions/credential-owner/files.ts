import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { syntheticSamples } from '../_shared/credential-synthetic-samples.ts';

import { isGeneratedEvidence } from './synthetic-media.ts';
export const maxFileBytes = 10_000_000;
export const maxRequestBytes = 2 * 4 * Math.ceil(maxFileBytes / 3) + 8192;
export const attachment = z
  .object({
    filename: z.string().min(5).max(128),
    mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
    file: z
      .string()
      .min(1)
      .max(4 * Math.ceil(maxFileBytes / 3)),
  })
  .strict();
type Part = z.infer<typeof attachment>;
export async function selectEvidence(data: {
  filename?: string;
  mime?: string;
  file?: string;
  files?: Part[];
}) {
  if (
    data.files &&
    (data.filename !== undefined || data.mime !== undefined || data.file !== undefined)
  )
    return null;
  const entries = data.files ?? [{ filename: data.filename, mime: data.mime, file: data.file }];
  if (entries.length < 1 || entries.length > 2) return null;
  const selected = [];
  for (const item of entries) {
    const part = await validatePart(item, entries.length, !data.files);
    if (!part) return null;
    selected.push(part);
  }
  return selected;
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

async function validatePart(
  item: { filename?: string; mime?: string; file?: string },
  count: number,
  legacy: boolean,
) {
  const sample = syntheticSamples.find((s) => s.mime === item.mime);
  if (!sample || !item.filename || (legacy && sample.mime !== 'image/png')) return null;
  const extension =
    sample.mime === 'application/pdf'
      ? /\.pdf$/i
      : sample.mime === 'image/jpeg'
        ? /\.jpe?g$/i
        : /\.png$/i;
  if (!extension.test(item.filename) || (sample.mime === 'application/pdf' && count !== 1))
    return null;
  if (!item.file || item.file.length > 4 * Math.ceil(maxFileBytes / 3)) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const binary = atob(item.file);
    if (!binary.length || binary.length > maxFileBytes) return null;
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return null;
  }
  const digest = await sha256(bytes);
  const approved = bytes.length === sample.size && digest === sample.digest;
  if (!approved && (legacy || !isGeneratedEvidence(bytes, sample.mime))) return null;
  return { mime: sample.mime, size: bytes.length, digest, bytes };
}

export async function stageEvidence(
  store: ReturnType<SupabaseClient['storage']['from']>,
  ready: { key?: string; keys?: string[] },
  parts: NonNullable<Awaited<ReturnType<typeof selectEvidence>>>,
  manifest: boolean,
) {
  if (manifest && !ready.keys) return null;
  const keys = ready.keys ?? [ready.key];
  if (
    !keys ||
    keys.length !== parts.length ||
    !ready.key ||
    keys[0] !== ready.key ||
    new Set(keys).size !== keys.length
  )
    return null;
  const uploaded: string[] = [];
  for (const [index, part] of parts.entries()) {
    const key = keys[index];
    if (!key) return null;
    const bytes = part.bytes;
    const upload = await store.upload(key, bytes, {
      contentType: part.mime,
      upsert: false,
      cacheControl: '0',
    });
    if (upload.error) {
      if (uploaded.length) await store.remove(uploaded);
      return null;
    }
    uploaded.push(key);
  }
  return uploaded;
}

export async function verifiedBytes(
  blob: Blob,
  meta: { digest?: string; mime?: string; size?: number },
) {
  const mime = meta.mime ?? 'image/png',
    size = meta.size ?? 69;
  if (blob.size !== size || size < 1 || size > maxFileBytes) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await sha256(bytes);
  if (digest !== meta.digest) return null;
  const pinned = syntheticSamples.some(
    (s) => s.size === size && s.mime === mime && s.digest === digest,
  );
  return pinned || isGeneratedEvidence(bytes, mime) ? bytes : null;
}
