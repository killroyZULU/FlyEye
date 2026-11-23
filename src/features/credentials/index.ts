import { lazy } from 'react';
export { createOwnerGateway, type OwnerGateway } from './owner-gateway';

export const CredentialPanel = lazy(() =>
  import('./CredentialPanel').then((module) => ({ default: module.CredentialPanel })),
);
export {
  credentialResult,
  matchesCredentialRequest,
  type CredentialRequest,
  type CredentialResult,
} from './workspace';
