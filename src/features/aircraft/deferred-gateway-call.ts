import type { AircraftDocumentGateway } from './document-gateway-contract';
import type { AircraftRegistryGateway } from './registry-gateway-contract';

type Gateway = AircraftDocumentGateway | AircraftRegistryGateway;

// Forward one explicit call after loading. Retain the gateway receiver and arguments;
// a rejected operation is returned to its caller without retry or result caching.
export function deferredGatewayCall<T extends Gateway, K extends keyof T>(
  load: () => Promise<T>,
  method: K,
): T[K] {
  return ((...args: unknown[]) =>
    load().then((gateway) => {
      const operation = gateway[method];
      if (typeof operation !== 'function') throw new Error('Unsupported aircraft gateway method.');
      return Reflect.apply(operation, gateway, args) as unknown;
    })) as T[K];
}
