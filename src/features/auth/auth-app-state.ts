import { AuthGatewayError, type AuthGatewayErrorCode } from './services/auth-gateway';
import { RECOVERY_COMPLETE_PATH, RECOVERY_REQUEST_PATH } from './recovery';
import { INVITATION_PATH } from './member-invitations';
export type AuthState =
  | 'checking-session'
  | 'signed-out'
  | 'signing-in'
  | 'loading-access'
  | 'starting-admin-onboarding'
  | 'admin-onboarding'
  | 'member-mfa-enrollment'
  | 'mfa-required'
  | 'verifying-mfa'
  | 'empty'
  | 'unauthorized'
  | 'conflict'
  | 'error'
  | 'success';
export type AuthRoute = 'sign-in' | 'recovery-request' | 'recovery-complete' | 'invitation';
export function currentAuthRoute(pathname: string): AuthRoute {
  if (pathname === RECOVERY_REQUEST_PATH) return 'recovery-request';
  if (pathname === RECOVERY_COMPLETE_PATH) return 'recovery-complete';
  if (pathname === INVITATION_PATH) return 'invitation';
  return 'sign-in';
}
export function safeError(error: unknown): { code: AuthGatewayErrorCode; message: string } {
  if (error instanceof AuthGatewayError) {
    return { code: error.code, message: error.message };
  }

  return { code: 'unknown', message: 'FlyEye could not verify your access. Try again.' };
}
