import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../lib/database.types';
import { SupabaseAircraftDocumentGateway } from './document-gateway';
import { SupabaseAircraftRegistryGateway } from './gateway';

const correlationId = '40000000-0000-4000-8000-000000000001';
const page = { decision: 'listed', page: 1, pageSize: 25, hasNext: false, correlationId };
type Prepare = (
  client: SupabaseClient<Database>,
  beforeLoad: () => Promise<void>,
) => {
  call: () => Promise<unknown>;
  loads: () => number;
};

function checkDeferredGateway(name: string, data: unknown, prepare: Prepare) {
  describe(`deferred ${name} gateway`, () => {
    it('loads only on demand and shares loading without coalescing commands', async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const invoke = vi.fn().mockResolvedValue({ data, error: null });
      const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
      const gateway = prepare(client, () => held);
      expect(gateway.loads()).toBe(0);
      const first = gateway.call();
      const second = gateway.call();
      await Promise.resolve();
      expect(gateway.loads()).toBe(1);
      expect(invoke).not.toHaveBeenCalled();
      release();
      expect(await Promise.all([first, second])).toEqual([data, data]);
      expect(invoke).toHaveBeenCalledTimes(2);
      await gateway.call();
      expect(gateway.loads()).toBe(1);
      expect(invoke).toHaveBeenCalledTimes(3);
    });

    it('issues no request on load failure and retries only on an explicit later call', async () => {
      const beforeLoad = vi
        .fn()
        .mockRejectedValueOnce(new Error('synthetic module failure'))
        .mockResolvedValue(undefined);
      const invoke = vi.fn().mockResolvedValue({ data, error: null });
      const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
      const gateway = prepare(client, beforeLoad);
      await expect(gateway.call()).rejects.toMatchObject({ code: 'service_unavailable' });
      await Promise.resolve();
      expect(gateway.loads()).toBe(1);
      expect(invoke).not.toHaveBeenCalled();
      await expect(gateway.call()).resolves.toEqual(data);
      expect(gateway.loads()).toBe(2);
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('preserves authority errors and never reloads or repeats the rejected command', async () => {
      const invoke = vi.fn().mockResolvedValue({
        data: null,
        error: {
          context: new Response(JSON.stringify({ error: { code: 'unauthorized' } })),
        },
      });
      const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
      const gateway = prepare(client, () => Promise.resolve());
      await expect(gateway.call()).rejects.toMatchObject({ code: 'unauthorized' });
      await Promise.resolve();
      expect(gateway.loads()).toBe(1);
      expect(invoke).toHaveBeenCalledTimes(1);
      invoke.mockResolvedValue({ data, error: null });
      await expect(gateway.call()).resolves.toEqual(data);
      expect(gateway.loads()).toBe(1);
      expect(invoke).toHaveBeenCalledTimes(2);
    });
  });
}

checkDeferredGateway('registry', { ...page, records: [] }, (client, beforeLoad) => {
  const loader = vi.fn(async () => {
    await beforeLoad();
    return import('./registry-gateway-implementation');
  });
  const gateway = new SupabaseAircraftRegistryGateway(client, loader);
  return {
    call: () => gateway.list({ page: 1, includeArchived: false }),
    loads: () => loader.mock.calls.length,
  };
});

checkDeferredGateway('document', { ...page, aircraft: [] }, (client, beforeLoad) => {
  const loader = vi.fn(async () => {
    await beforeLoad();
    return import('./document-gateway-implementation');
  });
  const gateway = new SupabaseAircraftDocumentGateway(client, loader);
  return { call: () => gateway.listAircraft(), loads: () => loader.mock.calls.length };
});
