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
  expect(
    screen.getByLabelText('Supporting evidence (one PDF or one or two images)'),
  ).toBeRequired();
});
it('submits NTC replacement dates without adding license or ELP fields', () => {
  const submit = vi.fn();
  render(<OwnerLicenseForm category="ntc" busy={false} replacing onSubmit={submit} />);
  fireEvent.change(screen.getByLabelText('Issue date'), { target: { value: '2023-01-01' } });
  fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2024-01-01' } });
  const form = screen.getByRole('button', { name: 'Replace pending NTC version' }).closest('form');
  if (!form) throw Error('Expected NTC replacement form');
  fireEvent.submit(form);
  expect(submit).toHaveBeenCalledExactlyOnceWith(
    { category: 'ntc', issueDate: '2023-01-01', expiryDate: '2024-01-01', noExpiry: false },
    expect.any(File),
  );
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
