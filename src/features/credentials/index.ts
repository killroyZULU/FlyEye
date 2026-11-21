import { lazy } from 'react';

export const CredentialPanel = lazy(() =>
  import('./CredentialPanel').then((module) => ({ default: module.CredentialPanel })),
);
export {
  credentialResult,
  matchesCredentialRequest,
  type CredentialRequest,
  type CredentialResult,
} from './workspace';
