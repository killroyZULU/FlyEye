import { describe, expect, it } from 'vitest';
import { authorizedMetadata } from './credential-chromium-checkpoint.mjs';
import { publicLine, requireStatus } from './credential-checkpoint-log.mjs';
import { storagePullResult } from './credential-checkpoint-pull.mjs';

describe('focused hosted checkpoint', () => {
  it('retains only a fixed Storage pull outcome including unknown', () => {
    for (const [message, category] of [
      ['no space left on device', 'disk-full'],
      ['TOOMANYREQUESTS', 'rate-limited'],
      ['manifest unknown', 'manifest-unavailable'],
      ['unauthorized', 'registry-denial'],
      ['TLS handshake timeout', 'connection-error'],
      ['unrecognized', 'unknown'],
    ]) {
      expect(storagePullResult({ status: 1, stderr: 'private fixture detail ' + message })).toBe(
        category,
      );
    }
    expect(storagePullResult({ status: null, signal: 'SIGTERM', stderr: 'sensitive' })).toBe(
      'process-error',
    );
    expect(storagePullResult({ status: 0, stderr: 'sensitive' })).toBe('passed');
  });
  it('reports bounded HTTP failure categories without response bodies', () => {
    expect(() => requireStatus(403, 200)).toThrow(
      expect.objectContaining({ code: 'CHECKPOINT_4XX' }),
    );
    expect(() => requireStatus(503, 201)).toThrow(
      expect.objectContaining({ code: 'CHECKPOINT_5XX' }),
    );
    expect(publicLine('Session proof stopped at preview (http-4xx).')).toBe(
      'Session proof stopped at preview (http-4xx).',
    );
    expect(publicLine('Session proof stopped at preview (http-4xx private).')).toBeNull();
  });
  const member = { membershipId: 'owner', applicability: 'trainee' };
  const response = {
    decision: 'credential_workspace',
    organizationId: 'school',
    hasMore: false,
    members: [member],
  };
  it('recognizes only the authorized school and single expected owner', () => {
    expect(authorizedMetadata(response, 'school', 'owner')).toBe(true);
    for (const patch of [
      { organizationId: 'elsewhere' },
      { decision: 'denied' },
      { hasMore: true },
      { members: [] },
      { members: [member, member] },
      { members: [{ ...member, membershipId: 'other' }] },
    ]) {
      expect(authorizedMetadata({ ...response, ...patch }, 'school', 'owner')).toBe(false);
    }
  });
  it('only publishes fixed phase, failure and cleanup messages', () => {
    for (const line of [
      'Checkpoint: browser-password-passed',
      'Session proof stopped at preview (assertion).',
      'Test=failed teardown=passed inventory=match',
    ])
      expect(publicLine(line)).toBe(line);
    for (const line of [
      'Checkpoint: private',
      'Checkpoint: preview private-path',
      'Test=passed teardown=passed inventory=match extra',
      'Authorization: private',
      'Local receipt: private-path',
      'Session proof stopped at secret (operation).',
    ])
      expect(publicLine(line)).toBeNull();
  });
});
