import * as fixture from './onboarding-limiter-fixture.mjs';
import { createPruningCases } from './limiter-pruning-cases.mjs';

export const pruningCases = createPruningCases(
  {
    ...fixture,
    seed: (action, tokens, time, key) => fixture.seed(action, tokens, key, time),
  },
  {
    subjectAction: 'complete',
    sentinelAction: 'start',
    otherAction: 'status',
    retention: '15 minutes',
  },
);
