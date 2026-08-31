import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../lib/database.types';
import { AircraftRegistryError, SupabaseAircraftRegistryGateway } from './gateway';

/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest matchers inspect dynamic SDK calls. */

const record = {
  id: '50000000-0000-4000-8000-000000000001',
  registrationMark: 'RP-C123',
  manufacturer: 'Cessna',
  model: '172S',
  registryState: 'tracked',
  version: 1,
  updatedAt: '2026-08-29T00:00:00Z',
} as const;
const correlationId = '40000000-0000-4000-8000-000000000001';

function gateway(invoke: ReturnType<typeof vi.fn>) {
  const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
  return new SupabaseAircraftRegistryGateway(client);
}

describe('Supabase aircraft registry gateway', () => {
  it('validates list, detail, and mutation responses', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          decision: 'listed',
          records: [record],
          page: 1,
          pageSize: 25,
          hasNext: false,
          correlationId,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { decision: 'found', record, correlationId },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { decision: 'created', record, replayed: false, correlationId },
        error: null,
      });
    const subject = gateway(invoke);
    await expect(subject.list({ includeArchived: false, page: 1 })).resolves.toMatchObject({
      records: [record],
    });
    await expect(subject.get(record.id)).resolves.toEqual(record);
    await expect(
      subject.create({
        registrationMark: record.registrationMark,
        manufacturer: record.manufacturer,
        model: record.model,
        idempotencyKey: 'a'.repeat(32),
      }),
    ).resolves.toMatchObject({ decision: 'created' });
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      'aircraft-registry',
      expect.objectContaining({ body: expect.objectContaining({ pageSize: 25 }) }),
    );
  });

  it('maps stable Edge errors to safe browser errors', async () => {
    const context = Response.json(
      { error: { code: 'aircraft_registry.rate_limited', retryAfterSeconds: 12 } },
      { status: 429 },
    );
    const subject = gateway(vi.fn().mockResolvedValue({ data: null, error: { context } }));
    await expect(subject.list({ includeArchived: false, page: 1 })).rejects.toMatchObject({
      code: 'rate_limited',
      message: 'Wait 12 seconds before trying again.',
    });
  });

  it('fails closed on malformed provider results and network errors', async () => {
    await expect(
      gateway(vi.fn().mockResolvedValue({ data: { decision: 'listed' }, error: null })).list({
        includeArchived: false,
        page: 1,
      }),
    ).rejects.toBeInstanceOf(AircraftRegistryError);
    await expect(
      gateway(vi.fn().mockRejectedValue(new TypeError('offline'))).get(record.id),
    ).rejects.toMatchObject({ code: 'service_unavailable' });
  });
});
