import { createHash } from 'node:crypto';
import {
  prepareStagingGrant,
  stagingGrantCommand,
  classifyStagingGrantResult,
} from './feat-003-staging-issuer.mjs';

// Dependency injection is only for offline transport tests. The CLI supplies fixed implementations.
export async function executeStagingGrant(input, transaction, operator) {
  const plan = prepareStagingGrant(input, transaction);
  const command = stagingGrantCommand(plan);
  // No operator callback (including environment/terminal/tool access) runs before preflight.
  if (!operator.isInteractive()) throw new Error('FEAT-003 staging issuance rejected.');
  const tool = await operator.readTool();
  if (createHash('sha256').update(tool).digest('hex') !== plan.toolSha256) {
    throw new Error('FEAT-003 staging issuance rejected.');
  }
  if (!operator.cleanCheckout() || !operator.supportedTool()) {
    throw new Error('FEAT-003 staging issuance rejected.');
  }
  if ((await operator.confirm()) !== plan.approvalReference) {
    throw new Error('FEAT-003 staging issuance rejected.');
  }
  // The reference/typed confirmation is an operator gate, not authenticated approval evidence.
  // A separately authorized P4 run must establish provenance and current owner authority.
  try {
    return classifyStagingGrantResult(await operator.run(command));
  } catch {
    return 'uncertain';
  }
}
