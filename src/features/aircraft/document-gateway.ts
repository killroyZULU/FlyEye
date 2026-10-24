import { deferredGatewayCall } from './deferred-gateway-call';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/database.types';
import { AircraftDocumentError, type AircraftDocumentGateway } from './document-gateway-contract';
export {
  AircraftDocumentError,
  type AircraftDocumentErrorCode,
  type AircraftDocumentGateway,
  type AircraftDocumentMutationInput,
} from './document-gateway-contract';

type LoadGateway = () => Promise<typeof import('./document-gateway-implementation')>;

export class SupabaseAircraftDocumentGateway implements AircraftDocumentGateway {
  private pending?: Promise<AircraftDocumentGateway>;

  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly loadGateway: LoadGateway = () => import('./document-gateway-implementation'),
  ) {}

  private load = (): Promise<AircraftDocumentGateway> => {
    // Share loading only, never cache command results or automatically repeat a request.
    this.pending ??= Promise.resolve()
      .then(this.loadGateway)
      .then(({ SupabaseAircraftDocumentGateway: Gateway }) => new Gateway(this.client))
      .catch(() => {
        this.pending = undefined;
        throw new AircraftDocumentError(
          'service_unavailable',
          'Aircraft documents are temporarily unavailable. Try again.',
        );
      });
    return this.pending;
  };

  listAircraft = deferredGatewayCall(this.load, 'listAircraft');

  listStatus = deferredGatewayCall(this.load, 'listStatus');

  detail = deferredGatewayCall(this.load, 'detail');

  history = deferredGatewayCall(this.load, 'history');

  create = deferredGatewayCall(this.load, 'create');

  renew = deferredGatewayCall(this.load, 'renew');

  correct = deferredGatewayCall(this.load, 'correct');

  suspend = deferredGatewayCall(this.load, 'suspend');

  restore = deferredGatewayCall(this.load, 'restore');

  createCategory = deferredGatewayCall(this.load, 'createCategory');

  renameCategory = deferredGatewayCall(this.load, 'renameCategory');

  assignCategory = deferredGatewayCall(this.load, 'assignCategory');

  removeCategory = deferredGatewayCall(this.load, 'removeCategory');

  archiveCategory = deferredGatewayCall(this.load, 'archiveCategory');

  listNotifications = deferredGatewayCall(this.load, 'listNotifications');

  openNotification = deferredGatewayCall(this.load, 'openNotification');

  upload = deferredGatewayCall(this.load, 'upload');

  download = deferredGatewayCall(this.load, 'download');
}
