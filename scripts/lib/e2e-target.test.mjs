import { describe, expect, it } from 'vitest';
import { loopbackTarget } from './e2e-target.mjs';

describe('E2E target selection', () => {
  it('preserves the default and changes only the loopback port', () => {
    expect(loopbackTarget()).toEqual({ port: '4173', origin: 'http://127.0.0.1:4173' });
    expect(loopbackTarget('50123')).toEqual({ port: '50123', origin: 'http://127.0.0.1:50123' });
  });
  it.each([
    '',
    '0',
    '80',
    '1023',
    '65536',
    '04173',
    ' 4173',
    '4173/',
    'localhost:4173',
    'https://example.invalid',
  ])('refuses invalid override %j', (port) => {
    expect(() => loopbackTarget(port)).toThrow('E2E port');
  });
});
