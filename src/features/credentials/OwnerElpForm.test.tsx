import { fireEvent, render, screen } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { OwnerLicenseForm } from './OwnerLicenseForm';
it('requires a level and an explicit expiry choice independent of Level 6', () => {
  render(<OwnerLicenseForm category="elp" replacing={false} busy={false} onSubmit={vi.fn()} />);
  expect(screen.queryByLabelText('License number')).toBeNull();
  const level = screen.getByLabelText('ELP level');
  expect(level).toBeInvalid();
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    'Select a level',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
  ]);
  fireEvent.change(level, { target: { value: '6' } });
  expect(screen.getByLabelText('No expiry')).not.toBeChecked();
  const issue = screen.getByLabelText('Issue date');
  expect(issue).toHaveAttribute(
    'max',
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
  );
  fireEvent.change(issue, { target: { value: '2020-01-15' } });
  const expiry = screen.getByLabelText('Expiry date');
  expect(expiry).toBeRequired();
  fireEvent.change(expiry, { target: { value: '2020-01-14' } });
  expect(expiry).toBeInvalid();
  fireEvent.change(expiry, { target: { value: '2023-06-30' } });
  expect(expiry).toBeValid();
  fireEvent.click(screen.getByLabelText('No expiry'));
  expect(screen.queryByLabelText('Expiry date')).toBeNull();
  fireEvent.click(screen.getByLabelText('No expiry'));
  expect(screen.getByLabelText('Expiry date')).toBeInvalid();
});
