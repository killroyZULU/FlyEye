import { observeNoSendRestart } from './lib/no-send-restart-observation.mjs';

const result = await observeNoSendRestart();
if (!result.passed || !result.cleanupPassed) process.exitCode = 1;
