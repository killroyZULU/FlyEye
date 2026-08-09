import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  createIdempotencyKey,
  invitationCredentialSchema,
  invitationHintFromUrl,
  scrubInvitationHint,
} from '../member-invitations';
import { AuthGatewayError, type AuthGateway } from '../services/auth-gateway';
import { StatePanel } from './StatePanel';

type Props = { gateway: AuthGateway };

export function InvitationAcceptanceFlow({ gateway }: Props) {
  const [hint] = useState(() => invitationHintFromUrl(new URL(window.location.href)));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [sessionState, setSessionState] = useState<'checking' | 'ready' | 'unavailable'>(() =>
    hint ? 'checking' : 'unavailable',
  );
  const [message, setMessage] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!hint) return;
    let active = true;
    void gateway
      .hasSession()
      .then((hasSession) => {
        if (!active) return;
        if (hasSession) {
          scrubInvitationHint(window.history);
          setSessionState('ready');
        } else {
          setSessionState('unavailable');
        }
      })
      .catch(() => {
        if (active) setSessionState('unavailable');
      });
    return () => {
      active = false;
    };
  }, [gateway, hint]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [accepted, sessionState]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const credential = invitationCredentialSchema.safeParse(password);
    if (!hint || !credential.success) {
      setMessage(
        hint
          ? 'Enter your FlyEye password.'
          : 'This invitation link is incomplete or no longer available.',
      );
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      await gateway.prepareInvitationCredential(credential.data, {
        invitationId: hint.invitationId,
        expectedVersion: hint.version,
      });
      await gateway.acceptMemberInvitation({
        invitationId: hint.invitationId,
        expectedVersion: hint.version,
        idempotencyKey: createIdempotencyKey(),
      });
      setPassword('');
      setAccepted(true);
    } catch (error) {
      setMessage(
        error instanceof AuthGatewayError
          ? error.message
          : 'This invitation could not be accepted.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (accepted) {
    return (
      <section className="state-panel state-panel--success" aria-live="polite">
        <span className="eyebrow">Invitation accepted</span>
        <h2 ref={headingRef} tabIndex={-1}>
          Your membership is ready
        </h2>
        <p>FlyEye created your organization membership and initial role together.</p>
        <a className="primary-link" href="/">
          Continue to your workspace
        </a>
      </section>
    );
  }

  if (sessionState === 'checking') {
    return (
      <StatePanel
        eyebrow="School invitation"
        title="Verifying your invitation session"
        headingRef={headingRef}
      >
        <p>FlyEye is securely opening the account connected to this invitation.</p>
      </StatePanel>
    );
  }

  if (sessionState === 'unavailable') {
    return (
      <StatePanel
        eyebrow="School invitation"
        title="Invitation link unavailable"
        tone="warning"
        headingRef={headingRef}
      >
        <p>
          Open the latest invitation email again, or ask your organization administrator to resend
          it.
        </p>
        <a className="text-link" href="/">
          Return to sign in
        </a>
      </StatePanel>
    );
  }

  return (
    <section>
      <div className="section-heading">
        <span className="eyebrow">School invitation</span>
        <h2 ref={headingRef} tabIndex={-1}>
          Review and accept
        </h2>
        <p>
          Opening the email link did not join the organization. Confirm with your account password
          to accept explicitly.
        </p>
      </div>
      <form className="auth-form" onSubmit={(event) => void accept(event)} noValidate>
        <div className="field-group">
          <label htmlFor="invitation-password">FlyEye password</label>
          <input
            id="invitation-password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
          <span className="field-guidance">
            New invitees establish a password here. Existing users enter their current password.
          </span>
        </div>
        <div className="status-message" role="status" aria-live="polite">
          {message ?? ''}
        </div>
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Accepting invitation...' : 'Accept invitation'}
        </button>
        <a className="text-link" href="/">
          Do not accept
        </a>
      </form>
    </section>
  );
}
