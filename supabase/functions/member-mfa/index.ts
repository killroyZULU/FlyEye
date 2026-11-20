import { localMemberMfaHandler } from './runtime.ts';

Deno.serve(await localMemberMfaHandler((name) => Deno.env.get(name)));
