import { type FormEvent, useEffect, useRef } from 'react';

import type { MemberProfile } from '../member-administration';
import type { ProfileError, ProfileField } from './useMemberProfile';

type MemberProfileFormProps = {
  profile: MemberProfile;
  displayName: string;
  contactNumber: string;
  busy: boolean;
  errors: ProfileError[];
  onDisplayNameChange: (value: string) => void;
  onContactNumberChange: (value: string) => void;
  onSave: (event: FormEvent) => Promise<void>;
};

const profileFieldIds: Record<ProfileField, string> = {
  displayName: 'member-display-name',
  contactNumber: 'member-contact-number',
};

export function MemberProfileForm({
  profile,
  displayName,
  contactNumber,
  busy,
  errors,
  onDisplayNameChange,
  onContactNumberChange,
  onSave,
}: MemberProfileFormProps) {
  const validationSummary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length > 0) validationSummary.current?.focus();
  }, [errors]);

  function focusProfileField(field: ProfileField) {
    document.getElementById(profileFieldIds[field])?.focus();
  }

  const displayNameError = errors.find((error) => error.field === 'displayName');
  const contactNumberError = errors.find((error) => error.field === 'contactNumber');

  return (
    <form className="member-form" onSubmit={(event) => void onSave(event)} noValidate>
      {!profile.complete ? (
        <p className="notice notice--warning">Complete your display name to finish this profile.</p>
      ) : null}

      {errors.length > 0 ? (
        <div className="validation-summary" role="alert" tabIndex={-1} ref={validationSummary}>
          <strong>Review your profile</strong>
          <ul>
            {errors.map((error) => (
              <li key={`${error.field}:${error.message}`}>
                <a
                  href={`#${profileFieldIds[error.field]}`}
                  onClick={(event) => {
                    event.preventDefault();
                    focusProfileField(error.field);
                  }}
                >
                  {error.message}
                </a>
              </li>
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
          aria-invalid={Boolean(displayNameError)}
          aria-describedby={`member-display-name-guidance${displayNameError ? ' member-display-name-error' : ''}`}
          onChange={(event) => onDisplayNameChange(event.target.value)}
          autoComplete="name"
        />
        <span className="field-guidance" id="member-display-name-guidance">
          Required, 2 to 80 characters.
        </span>
        {displayNameError ? (
          <span className="field-error" id="member-display-name-error">
            {displayNameError.message}
          </span>
        ) : null}
      </div>

      <div className="field-group">
        <label htmlFor="member-contact-number">Contact number (optional)</label>
        <input
          id="member-contact-number"
          type="tel"
          value={contactNumber}
          maxLength={32}
          disabled={busy}
          aria-invalid={Boolean(contactNumberError)}
          aria-describedby={`member-contact-number-guidance${contactNumberError ? ' member-contact-number-error' : ''}`}
          onChange={(event) => onContactNumberChange(event.target.value)}
          autoComplete="tel"
        />
        <span className="field-guidance" id="member-contact-number-guidance">
          Administrative convenience only; it is not verified or used for sign-in.
        </span>
        {contactNumberError ? (
          <span className="field-error" id="member-contact-number-error">
            {contactNumberError.message}
          </span>
        ) : null}
      </div>

      <button className="primary-button" type="submit" disabled={busy}>
        {busy ? 'Saving profile' : 'Save profile'}
      </button>
    </form>
  );
}
