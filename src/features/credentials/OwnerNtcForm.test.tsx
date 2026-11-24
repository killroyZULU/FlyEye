import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OwnerLicenseForm } from './OwnerLicenseForm';
import { CredentialDeclaration } from './CredentialDeclaration';

it('requires an explicit expiry choice and synthetic evidence for NTC submission', () => {
  render(<OwnerLicenseForm category="ntc" busy={false} replacing={false} onSubmit={vi.fn()} />);
  expect(screen.queryByLabelText('License number')).toBeNull();
  expect(screen.queryByLabelText('ELP level')).toBeNull();
  expect(screen.getByLabelText('Issue date')).toBeRequired();
  expect(screen.getByLabelText('Expiry date')).toBeRequired();
  expect(screen.getByLabelText('No expiry')).not.toBeChecked();
  fireEvent.click(screen.getByLabelText('No expiry'));
  expect(screen.queryByLabelText('Expiry date')).toBeNull();
  expect(screen.getByLabelText('Synthetic supporting PNG')).toBeRequired();
});
it('offers the NTC declaration separately and renders the required state', () => {
  const declare = vi.fn();
  const props = { category: 'ntc' as const, busy: false, assured: true, declare };
  const view = render(<CredentialDeclaration {...props} state="undeclared" />);
  fireEvent.click(screen.getByRole('button', { name: 'Declare NTC not yet obtained' }));
  expect(declare).toHaveBeenCalledOnce();
  view.rerender(<CredentialDeclaration {...props} state="required" />);
  expect(screen.getByText(/NTC required/)).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
});
