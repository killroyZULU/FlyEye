import * as fixture from './invitation-limiter-fixture.mjs';
import { createPruningCases } from './limiter-pruning-cases.mjs';

export const pruningCases = createPruningCases(fixture, {
  subjectAction: 'resend',
  sentinelAction: 'create',
  otherAction: 'list',
  retention: '2 hours',
});
