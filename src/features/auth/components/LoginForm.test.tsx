import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from './LoginForm';

describe('sign-in foundation behavior preservation', () => {
  it('retains entered work and linked validation errors without submitting invalid input', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue(undefined);
    render(<LoginForm busy={false} onSubmit={submit} />);
    await user.type(screen.getByLabelText('Email address'), 'invalid');
    await user.click(screen.getByRole('button', { name: 'Sign in securely' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email address')).toHaveValue('invalid');
    expect(screen.getByLabelText('Email address')).toHaveAccessibleDescription(
      'Enter a valid email address.',
    );
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Enter your password.');
  });

  it('keeps input identity, values and visibility through pending and rejected presentation', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<LoginForm busy={false} onSubmit={submit} />);
    const email = screen.getByLabelText('Email address');
    const password = screen.getByLabelText('Password');
    await user.type(email, 'student@example.test');
    await user.type(password, 'SyntheticPassword1!');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    await user.click(password);
    await user.keyboard('{Enter}');
    expect(submit).toHaveBeenCalledWith({
      email: 'student@example.test',
      password: 'SyntheticPassword1!',
    });
    rerender(<LoginForm busy onSubmit={submit} />);
    expect(email).toBeDisabled();
    expect(password).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Signing in…' }));
    expect(submit).toHaveBeenCalledTimes(1);
    rerender(
      <LoginForm
        busy={false}
        message="The email or password is incorrect, or access is unavailable."
        onSubmit={submit}
      />,
    );
    expect(screen.getByLabelText('Password')).toBe(password);
    expect(password).toHaveValue('SyntheticPassword1!');
    expect(email).toHaveValue('student@example.test');
    expect(screen.getByRole('status')).toHaveTextContent(
      'The email or password is incorrect, or access is unavailable.',
    );
    expect(password).toHaveAttribute('autocomplete', 'current-password');
  });
});
