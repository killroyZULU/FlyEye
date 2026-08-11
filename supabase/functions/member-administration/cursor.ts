import { z } from 'zod';

import type { CursorBoundary } from './handler.ts';

const payloadSchema = z
  .object({
    createdAt: z.string().min(1).max(80),
    membershipId: z.uuid(),
    status: z.enum(['active', 'suspended', 'revoked']).nullable(),
    search: z.string().min(2).max(80).nullable(),
  })
  .strict();

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error('Invalid cursor signature.');
  const pairs = value.match(/.{2}/gu) ?? [];
  const bytes = new Uint8Array(pairs.length);
  pairs.forEach((pair, index) => {
    bytes[index] = Number.parseInt(pair, 16);
  });
  return bytes;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

export async function createMemberCursorCodec(secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

  async function sign(value: string): Promise<string> {
    return bytesToHex(
      new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))),
    );
  }

  return {
    encode: async (
      boundary: CursorBoundary,
      status: string | null,
      search: string | null,
    ): Promise<string> => {
      const encoded = encodeBase64Url(JSON.stringify({ ...boundary, status, search }));
      return `${encoded}.${await sign(encoded)}`;
    },
    decode: async (
      cursor: string,
      status: string | null,
      search: string | null,
    ): Promise<CursorBoundary> => {
      const [encoded, signature, extra] = cursor.split('.');
      if (!encoded || !signature || extra || signature.length !== 64) {
        throw new Error('Invalid cursor.');
      }
      if (
        !(await crypto.subtle.verify(
          'HMAC',
          key,
          hexToBytes(signature),
          new TextEncoder().encode(encoded),
        ))
      ) {
        throw new Error('Invalid cursor.');
      }
      const payload = payloadSchema.parse(JSON.parse(decodeBase64Url(encoded)));
      if (payload.status !== status || payload.search !== search) {
        throw new Error('Mismatched cursor.');
      }
      return { createdAt: payload.createdAt, membershipId: payload.membershipId };
    },
  };
}
