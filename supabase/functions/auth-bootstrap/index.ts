import { createAuthBootstrapHandler } from './handler.ts';
import { createAuthBootstrapDependencies } from './runtime.ts';

Deno.serve(
  createAuthBootstrapHandler(createAuthBootstrapDependencies((name) => Deno.env.get(name))),
);
