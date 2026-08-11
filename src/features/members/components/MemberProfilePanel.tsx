import { useEffect, useRef, useState } from 'react';

import { AuthGatewayError, type AuthGateway } from '../../auth/services/auth-gateway';
import { profileFormSchema, type MemberProfile } from '../member-administration';

type MemberProfilePanelProps = {
  gateway: AuthGateway;
  membershipId: string;
  onClose: () => void;
};

function safeMessage(error: unknown): string {
  return error instanceof AuthGatewayError
    ? error.message
    : 'Your profile could not be verified. Try again.';
}

export function MemberProfilePanel({ gateway, membershipId, onClose }: MemberProfilePanelProps) {
  const [profile, setProfile] = useState<MemberProfile>();
  const [displayName, setDisplayName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [errors, setErrors] = useState<string[]>([]);
  const mounted = useRef(true);
  const validationSummary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (errors.length > 0) validationSummary.current?.focus();
  }, [errors]);

  useEffect(() => {
    mounted.current = true;
    async function load() {
      setBusy(true);
      setMessage(undefined);
      try {
        const next = await gateway.loadMyMemberProfile(membershipId);
        if (!mounted.current) return;
        setProfile(next);
        setDisplayName(next.displayName ?? '');
        setContactNumber(next.contactNumber ?? '');
      } catch (error) {
        if (mounted.current) setMessage(safeMessage(error));
      } finally {
        if (mounted.current) setBusy(false);
      }
    }
    void load();
    return () => {
      mounted.current = false;
    };
  }, [gateway, membershipId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsed = profileFormSchema.safeParse({ displayName, contactNumber });
    if (!parsed.success) {
      setErrors([...new Set(parsed.error.issues.map((issue) => issue.message))]);
      setMessage('Review the highlighted profile fields.');
      return;
    }
    if (!profile) return;
    if (!navigator.onLine) {
      setMessage('You are offline. Profile changes are not queued; reconnect and try again.');
      return;
    }

    setBusy(true);
    setErrors([]);
    setMessage(undefined);
    try {
      const next = await gateway.updateMyMemberProfile({
        membershipId,
        displayName: parsed.data.displayName,
        contactNumber: parsed.data.contactNumber,
        expectedVersion: profile.version,
      });
      if (!mounted.current) return;
      setProfile(next);
      setDisplayName(next.displayName ?? '');
      setContactNumber(next.contactNumber ?? '');
      setMessage('Your organization profile was saved.');
    } catch (error) {
      if (mounted.current) setMessage(safeMessage(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="member-workspace" aria-labelledby="profile-heading">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Organization profile</span>
          <h2 id="profile-heading">My basic profile</h2>
        </div>
        <button className="text-button" type="button" onClick={onClose}>
          Back to workspace
        </button>
      </div>

      {busy && !profile ? (
        <div role="status">
          <div className="loading-line" aria-hidden="true" />
          <p>Loading your current organization profile.</p>
        </div>
      ) : null}

      {profile ? (
        <form className="member-form" onSubmit={(event) => void save(event)} noValidate>
          {!profile.complete ? (
            <p className="notice notice--warning">
              Complete your display name to finish this profile.
            </p>
          ) : null}

          {errors.length > 0 ? (
            <div className="validation-summary" role="alert" tabIndex={-1} ref={validationSummary}>
              <strong>Review your profile</strong>
              <ul>
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="readonly-grid">
            <div>
              <span>Organization</span>
              <strong>{profile.organizationName}</strong>
            </div>
            <div>
              <span>Current role</span>
              <strong>{profile.roleLabel}</strong>
            </div>
            <div>
              <span>Account email</span>
              <strong>{profile.email}</strong>
            </div>
          </div>
          <p className="field-guidance">
            Email and role are read-only. This display name is not verified legal identity.
          </p>

          <div className="field-group">
            <label htmlFor="member-display-name">Display name</label>
            <input
              id="member-display-name"
              value={displayName}
              maxLength={80}
              disabled={busy}
              aria-invalid={errors.some((error) => error.includes('2 to 80'))}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
            />
            <span className="field-guidance">Required, 2 to 80 characters.</span>
          </div>

          <div className="field-group">
            <label htmlFor="member-contact-number">Contact number (optional)</label>
            <input
              id="member-contact-number"
              type="tel"
              value={contactNumber}
              maxLength={32}
              disabled={busy}
              onChange={(event) => setContactNumber(event.target.value)}
              autoComplete="tel"
            />
            <span className="field-guidance">
              Administrative convenience only; it is not verified or used for sign-in.
            </span>
          </div>

          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'Saving profile' : 'Save profile'}
          </button>
        </form>
      ) : null}

      <p className="status-message" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
