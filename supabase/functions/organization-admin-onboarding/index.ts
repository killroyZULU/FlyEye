import { localAdminOnboardingHandler } from './runtime.ts';

Deno.serve(await localAdminOnboardingHandler((name) => Deno.env.get(name)));
