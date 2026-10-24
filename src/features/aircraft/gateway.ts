import { deferredGatewayCall } from './deferred-gateway-call';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/database.types';
import { AircraftRegistryError, type AircraftRegistryGateway } from './registry-gateway-contract';
export {
  AircraftRegistryError,
  isAircraftAccessRevoked,
  type AircraftRegistryErrorCode,
  type AircraftRegistryGateway,
} from './registry-gateway-contract';

type LoadGateway = () => Promise<typeof import('./registry-gateway-implementation')>;

export class SupabaseAircraftRegistryGateway implements AircraftRegistryGateway {
  private pending?: Promise<AircraftRegistryGateway>;

  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly loadGateway: LoadGateway = () => import('./registry-gateway-implementation'),
  ) {}

  private load = (): Promise<AircraftRegistryGateway> => {
    // A failed load issues no command; only another caller can try loading again.
    this.pending ??= Promise.resolve()
      .then(this.loadGateway)
      .then(({ SupabaseAircraftRegistryGateway: Gateway }) => new Gateway(this.client))
      .catch(() => {
        this.pending = undefined;
        throw new AircraftRegistryError(
          'service_unavailable',
          'The aircraft registry is temporarily unavailable. Try again.',
        );
      });
    return this.pending;
  };

  list = deferredGatewayCall(this.load, 'list');

  get = deferredGatewayCall(this.load, 'get');

  create = deferredGatewayCall(this.load, 'create');

  update = deferredGatewayCall(this.load, 'update');

  archive = deferredGatewayCall(this.load, 'archive');

  reactivate = deferredGatewayCall(this.load, 'reactivate');
}
