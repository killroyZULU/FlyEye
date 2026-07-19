import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { SupabaseAuthGateway } from '../features/auth/services/auth-gateway';
import type { Database } from './database.types';

const environmentSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(10)
    .refine(isSafeBrowserKey, 'A server-only Supabase key cannot be used by the browser.'),
});

function jwtRole(value: string): string | undefined {
  try {
    const payloadSegment = value.split('.')[1];
    if (!payloadSegment) return undefined;
    const padded = payloadSegment
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : undefined;
  } catch {
    return undefined;
  }
}

export function isSafeBrowserKey(value: string): boolean {
  const normalized = value.toLowerCase();
  const secretPrefix = ['sb', 'secret', ''].join('_');
  if (normalized.startsWith(secretPrefix) || normalized.includes('service_role')) return false;
  return jwtRole(value) !== 'service_role';
}

export function createBrowserAuthGateway(): SupabaseAuthGateway {
  const environment = environmentSchema.safeParse(import.meta.env);
  if (!environment.success) {
    throw new Error('FlyEye authentication is not configured for this environment.');
  }

  const client = createClient<Database>(
    environment.data.VITE_SUPABASE_URL,
    environment.data.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    },
  );

  return new SupabaseAuthGateway(client);
}
