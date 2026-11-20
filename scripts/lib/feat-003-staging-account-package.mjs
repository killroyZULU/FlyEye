import { readStagingGrantConfiguration } from './feat-003-staging-issuer.mjs';
import { readStagingBrowserConfiguration } from './feat-003-staging-browser-package.mjs';
import { ledgerSchema, observationSchema } from './staging-account-evidence.mjs';
import { reconcileStagingAccounts } from './staging-account-reconciliation.mjs';

// Offline review of the same configuration bytes used for the browser and first-Admin grant.
// The inventory and private journal are independent inputs; neither belongs in the frontend.
export function reconcilePackagedStagingAccounts(
  input,
  selection,
  ledgerText,
  observationText,
  reviewedGrantSql,
) {
  const rejected = { decision: 'stop', reason: 'package-conflict' };
  try {
    const config = readStagingGrantConfiguration(input, reviewedGrantSql);
    readStagingBrowserConfiguration(JSON.stringify(config.browser), selection);
    if (typeof ledgerText !== 'string' || ledgerText.length > 65536) return rejected;
    const ledger = ledgerSchema.parse(JSON.parse(ledgerText));
    const admin = ledger.slots.find((s) => s.role === 'admin');
    if (typeof observationText !== 'string' || observationText.length > 65536) return rejected;
    const view = observationSchema.parse(JSON.parse(observationText));
    const grant = view.slots.find((slot) => slot.role === 'admin')?.grant;
    if (
      !admin?.grantId ||
      ledger.slots.some(
        (s) => s.role !== 'admin' && s.plannedAuthId === config.stagingGrant.eligibleUserId,
      ) ||
      ledger.slots.some((s) => s.operationId === config.stagingGrant.eligibleUserId) ||
      view.slots.some(
        (s) =>
          s.role !== 'admin' && s.users.some((u) => u.id === config.stagingGrant.eligibleUserId),
      ) ||
      config.stagingGrant?.organizationId !== ledger.schoolId ||
      (admin.plannedAuthId && config.stagingGrant.eligibleUserId !== admin.plannedAuthId) ||
      (grant &&
        (grant.issuanceAttemptId !== config.stagingGrant.sourceInstanceId ||
          grant.provenance?.correlationId !== config.stagingGrant.issuanceCorrelationId)) ||
      config.stagingGrant.grantId !== admin.grantId
    )
      return rejected;
    const decision = reconcileStagingAccounts(ledgerText, observationText);
    if (decision.decision === 'plan' && decision.slots.admin.decision === 'create')
      decision.slots.admin.plannedAuthId = config.stagingGrant.eligibleUserId;
    return decision;
  } catch {
    return rejected;
  }
}
