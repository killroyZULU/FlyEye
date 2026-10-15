import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthRoute, AuthState } from '../auth-app-state';
import type { AuthGateway } from '../services/auth-gateway';
import type { AuthSession } from '../useAuthSession';
import { AuthEntryView } from './AuthEntryView';

vi.mock('./AuthSignInView', () => ({ AuthSignInView: () => <p>Existing sign-in content</p> }));
vi.mock('./InvitationAcceptanceFlow', () => ({
  InvitationAcceptanceFlow: () => <p>Invitation</p>,
}));
vi.mock('./PasswordRecoveryFlow', () => ({ PasswordRecoveryFlow: () => <p>Recovery</p> }));
vi.mock('./RecoveryRequestForm', () => ({ RecoveryRequestForm: () => <p>Recovery request</p> }));

describe('password-entry presentation boundary', () => {
  it.each<AuthState>(['signed-out', 'signing-in'])(
    'opts in only the password-entry state %s',
    (state) => {
      render(
        <AuthEntryView
          gateway={{} as AuthGateway}
          route="sign-in"
          session={{ state } as AuthSession}
        />,
      );
      expect(screen.getByRole('main')).toHaveClass('auth-shell--password');
    },
  );

  it.each<AuthState>([
    'checking-session',
    'loading-access',
    'starting-admin-onboarding',
    'admin-onboarding',
    'member-mfa-enrollment',
    'mfa-required',
    'verifying-mfa',
    'empty',
    'unauthorized',
    'conflict',
    'error',
    'success',
  ])('keeps existing presentation for %s', (state) => {
    render(
      <AuthEntryView
        gateway={{} as AuthGateway}
        route="sign-in"
        session={{ state } as AuthSession}
      />,
    );
    expect(screen.getByRole('main')).not.toHaveClass('auth-shell--password');
  });

  it.each<AuthRoute>(['invitation', 'recovery-request', 'recovery-complete'])(
    'does not opt in the separate %s route',
    async (route) => {
      render(
        <AuthEntryView
          gateway={{} as AuthGateway}
          route={route}
          session={{ state: 'signed-out' } as AuthSession}
        />,
      );
      await screen.findByRole('main');
      expect(screen.getByRole('main')).not.toHaveClass('auth-shell--password');
    },
  );
});
