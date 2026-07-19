import { describe, expect, it } from 'vitest';

import { isSafeBrowserKey } from './supabase';

function jwt(role: string): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role })}.synthetic-signature`;
}

describe('browser Supabase key boundary', () => {
  it('accepts publishable and legacy anonymous keys', () => {
    expect(isSafeBrowserKey('sb_publishable_synthetic-development-key')).toBe(true);
    expect(isSafeBrowserKey(jwt('anon'))).toBe(true);
  });

  it('rejects secret and service-role keys', () => {
    expect(isSafeBrowserKey(['sb', 'secret', 'synthetic-not-real-key'].join('_'))).toBe(false);
    expect(isSafeBrowserKey(jwt('service_role'))).toBe(false);
    expect(isSafeBrowserKey('synthetic-service_role-key')).toBe(false);
  });
});
