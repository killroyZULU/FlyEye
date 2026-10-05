import type { FactorInventoryClassification } from '../_shared/authentication-evidence.ts';
import type { MemberMfaContext, MemberMfaRequest } from './contracts.ts';
import { json } from './responses.ts';
import {
  readMfaStatus,
  startMfaEnrollment,
  bindMfaFactor,
  completeMfaEnrollment,
} from './enrollment.ts';
import { cancelMfaEnrollment } from './cancellation.ts';

export async function executeMfaAction(
  context: MemberMfaContext,
  input: MemberMfaRequest,
  classified: FactorInventoryClassification,
): Promise<Response> {
  const { origin, correlationId } = context;
  try {
    // Await RPC-backed actions inside the existing fail-closed error boundary.
    switch (input.action) {
      case 'status':
        return await readMfaStatus(context, classified);
      case 'start':
        return await startMfaEnrollment(context, input, classified);
      case 'bind_factor':
        return await bindMfaFactor(context, input, classified);
      case 'complete':
        return await completeMfaEnrollment(context, input, classified);
      case 'cancel':
        return await cancelMfaEnrollment(context, input, classified);
    }
  } catch {
    return json(origin, 500, {
      error: {
        code: 'member_mfa.audit_unavailable',
        message: 'Authenticator setup could not be verified.',
      },
      correlationId,
    });
  }
}
