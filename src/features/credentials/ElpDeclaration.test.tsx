import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CredentialDeclaration } from './CredentialDeclaration';

it('offers the explicit declaration only with an eligible server result and current assurance', () => {
  const declare = vi.fn();
  const { rerender } = render(
    <CredentialDeclaration
      category="elp"
      state="undeclared"
      assured={false}
      busy={false}
      declare={declare}
    />,
  );
  expect(screen.queryByRole('button')).toBeNull();
  rerender(
    <CredentialDeclaration category="elp" state="undeclared" assured busy declare={declare} />,
  );
  expect(screen.getByRole('button')).toBeDisabled();
  rerender(
    <CredentialDeclaration
      category="elp"
      state="undeclared"
      assured
      busy={false}
      declare={declare}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Declare ELP not yet obtained' }));
  expect(declare).toHaveBeenCalledOnce();
});
it.each(['not_yet_obtained', 'pending', 'approved', 'required'] as const)(
  'renders effective declaration controls for %s',
  (state) => {
    render(
      <CredentialDeclaration category="elp" state={state} assured busy={false} declare={vi.fn()} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(!!screen.queryByText('ELP — Not yet obtained')).toBe(state === 'not_yet_obtained');
    expect(!!screen.queryByText(/ELP required/)).toBe(state === 'required');
  },
);
