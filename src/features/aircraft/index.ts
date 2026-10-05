import { lazy } from 'react';
export const AircraftRegistryPanel = lazy(() =>
  import('./components/AircraftRegistryPanel').then((module) => ({
    default: module.AircraftRegistryPanel,
  })),
);
export const AircraftDocumentsPanel = lazy(() =>
  import('./components/AircraftDocumentsPanel').then((module) => ({
    default: module.AircraftDocumentsPanel,
  })),
);
export { aircraftDocumentCapabilities } from './aircraft-documents';
export {
  AircraftDocumentError,
  SupabaseAircraftDocumentGateway,
  type AircraftDocumentGateway,
} from './document-gateway';
export {
  AircraftRegistryError,
  SupabaseAircraftRegistryGateway,
  type AircraftRegistryGateway,
} from './gateway';
