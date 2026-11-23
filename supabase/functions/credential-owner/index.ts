import { readCommonEdgeRuntimeConfiguration } from '../_shared/edge-runtime-configuration.ts';
import { credentialOwnerHandler } from './handler.ts';

if (Deno.env.get('FLYEYE_RUNTIME_PROFILE') !== 'local-synthetic-v1') {
  throw new Error('The credential submission fixture requires a local synthetic target.');
}
Deno.serve(
  credentialOwnerHandler(readCommonEdgeRuntimeConfiguration((name) => Deno.env.get(name))),
);
