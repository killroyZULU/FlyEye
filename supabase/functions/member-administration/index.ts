import { createMemberAdministrationHandler } from './handler.ts';
import { createMemberAdministrationDependencies } from './runtime.ts';

Deno.serve(
  createMemberAdministrationHandler(
    await createMemberAdministrationDependencies((name) => Deno.env.get(name)),
  ),
);
