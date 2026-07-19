import { type FormEvent, useState } from 'react';

import { loginRequestSchema, type LoginRequest } from '../../../lib/access-context';

type LoginFormProps = {
  busy: boolean;
  message?: string;
  onSubmit: (request: LoginRequest) => Promise<void>;
};

export function LoginForm({ busy, message, onSubmit }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = loginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      const nextErrors: { email?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'email') {
          nextErrors.email = 'Enter a valid email address.';
        }
        if (issue.path[0] === 'password') {
          nextErrors.password = 'Enter your password.';
        }
      }
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    await onSubmit(parsed.data);
  }

  return (
    <form className="auth-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <div className="field-group">
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          aria-invalid={fieldErrors.email ? 'true' : 'false'}
          aria-describedby={fieldErrors.email ? 'email-error' : undefined}
          disabled={busy}
          onChange={(event) => setEmail(event.target.value)}
        />
        {fieldErrors.email ? (
          <span id="email-error" className="field-error">
            {fieldErrors.email}
          </span>
        ) : null}
      </div>

      <div className="field-group">
        <label htmlFor="password">Password</label>
        <div className="password-field">
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            aria-invalid={fieldErrors.password ? 'true' : 'false'}
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            className="password-toggle"
            type="button"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            disabled={busy}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        {fieldErrors.password ? (
          <span id="password-error" className="field-error">
            {fieldErrors.password}
          </span>
        ) : null}
      </div>

      <div className="status-message" role="status" aria-live="polite">
        {message ?? ''}
      </div>

      <button className="primary-button" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in securely'}
      </button>
    </form>
  );
}
