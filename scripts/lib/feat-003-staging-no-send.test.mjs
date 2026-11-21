// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { validateStagingNoSend } from './feat-003-staging-no-send.mjs';

const read = (name) => readFileSync(new URL(`../../config/${name}`, import.meta.url), 'utf8');
const manifest = read('feat-003-staging-environment.json');
const configuration = read('feat-003-staging-auth.json');
const rejection = 'FEAT-003 staging no-send configuration rejected.';

describe('P3d1 no-send configuration', () => {
  it('validates the checked-in policy offline without authorizing execution', () => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Unexpected network');
    });
    try {
      expect(validateStagingNoSend(manifest, configuration)).toEqual({
        policy: 'no-send-v1',
        executionAuthorized: false,
      });
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
  it.each(Object.keys(JSON.parse(configuration)))('rejects missing or changed %s', (key) => {
    for (const value of [undefined, null, 'secret-canary']) {
      const input = { ...JSON.parse(configuration), [key]: value };
      expect(() => validateStagingNoSend(manifest, JSON.stringify(input))).toThrow(rejection);
    }
  });
  it.each([null, '', 'null', '[]', '{secret-canary', 'x'.repeat(16385)])(
    'rejects malformed configuration without echoing it',
    (input) => {
      expect(() => validateStagingNoSend(manifest, input)).toThrow(rejection);
    },
  );
  it('rejects extras, disabled and substituted targets', () => {
    expect(() =>
      validateStagingNoSend(
        manifest,
        JSON.stringify({ ...JSON.parse(configuration), secret: 'secret-canary' }),
      ),
    ).toThrow(rejection);
    for (const changes of [
      { enabled: false },
      { projectRef: 'a'.repeat(20) },
      { environment: 'production' },
    ]) {
      expect(() =>
        validateStagingNoSend(
          JSON.stringify({ ...JSON.parse(manifest), ...changes }),
          configuration,
        ),
      ).toThrow(rejection);
    }
    expect(() => validateStagingNoSend('secret-canary', configuration)).toThrow(rejection);
  });
});
