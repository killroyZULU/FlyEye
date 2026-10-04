import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthGatewayError, type AuthGateway } from '../../auth/services/auth-gateway';
import { MemberProfilePanel } from './MemberProfilePanel';

const profile = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  organizationName: 'Synthetic Flight School',
  membershipId: '20000000-0000-4000-8000-000000000001',
  displayName: null,
  contactNumber: null,
  email: 'member@example.test',
  roleCode: 'student_pilot',
  roleLabel: 'Student Pilot',
  status: 'active' as const,
  version: 1,
  complete: false,
};

function gateway() {
  const loadMyMemberProfile = vi
    .fn<AuthGateway['loadMyMemberProfile']>()
    .mockResolvedValue(profile);
  const updateMyMemberProfile = vi.fn<AuthGateway['updateMyMemberProfile']>().mockResolvedValue({
    ...profile,
    displayName: 'Synthetic Member',
    version: 2,
    complete: true,
  });
  return {
    value: { loadMyMemberProfile, updateMyMemberProfile } as unknown as AuthGateway,
    loadMyMemberProfile,
    updateMyMemberProfile,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const completeProfile = {
  ...profile,
  displayName: 'Synthetic Member',
  contactNumber: '+63 2 555 0100',
  version: 4,
  complete: true,
};

function renderProfile(gatewayUnderTest = gateway()) {
  const onClose = vi.fn();
  return {
    ...render(
      <MemberProfilePanel
        gateway={gatewayUnderTest.value}
        membershipId={profile.membershipId}
        onClose={onClose}
      />,
    ),
    onClose,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('MemberProfilePanel', () => {
  it('loads the exact membership before showing editable fields and permits closing while loading', async () => {
    const gatewayUnderTest = gateway();
    const pending = deferred<Awaited<ReturnType<AuthGateway['loadMyMemberProfile']>>>();
    gatewayUnderTest.loadMyMemberProfile.mockReturnValue(pending.promise);
    const { onClose } = renderProfile(gatewayUnderTest);
    expect(screen.getByText('Loading your current organization profile.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument();
    expect(gatewayUnderTest.loadMyMemberProfile).toHaveBeenCalledExactlyOnceWith(
      profile.membershipId,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Back to workspace' }));
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve(profile);
      await pending.promise;
    });
    expect(screen.getByLabelText('Display name')).toHaveValue('');
    expect(screen.getByLabelText('Contact number (optional)')).toHaveValue('');
    expect(
      screen.queryByText('Loading your current organization profile.'),
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      new AuthGatewayError('member_administration_not_found', 'This profile is unavailable.'),
      'This profile is unavailable.',
    ],
    [
      new AuthGatewayError('member_administration_unavailable', 'Refresh and try again.'),
      'Refresh and try again.',
    ],
    [new Error('private-provider-diagnostic'), 'Your profile could not be verified. Try again.'],
  ])('shows a safe initial error without editable profile data (%s)', async (failure, message) => {
    const gatewayUnderTest = gateway();
    gatewayUnderTest.loadMyMemberProfile.mockRejectedValue(failure);
    renderProfile(gatewayUnderTest);
    expect(await screen.findByText(message)).toHaveAttribute('role', 'status');
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Loading your current organization profile.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('private-provider-diagnostic')).not.toBeInTheDocument();
    expect(gatewayUnderTest.updateMyMemberProfile).not.toHaveBeenCalled();
  });

  it('hydrates completed profiles while keeping identity and authority read-only', async () => {
    const gatewayUnderTest = gateway();
    gatewayUnderTest.loadMyMemberProfile.mockResolvedValue(completeProfile);
    renderProfile(gatewayUnderTest);
    expect(await screen.findByLabelText('Display name')).toHaveValue(completeProfile.displayName);
    expect(screen.getByLabelText('Contact number (optional)')).toHaveValue(
      completeProfile.contactNumber,
    );
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getByText(profile.organizationName)).toBeInTheDocument();
    expect(screen.getByText(profile.roleLabel)).toBeInTheDocument();
    expect(screen.getByText(profile.email)).toBeInTheDocument();
    expect(
      screen.queryByText('Complete your display name to finish this profile.'),
    ).not.toBeInTheDocument();
  });

  it('disables fields while saving normalized values and uses the returned version for the next save', async () => {
    const gatewayUnderTest = gateway();
    const pending = deferred<Awaited<ReturnType<AuthGateway['updateMyMemberProfile']>>>();
    gatewayUnderTest.updateMyMemberProfile.mockReturnValueOnce(pending.promise);
    renderProfile(gatewayUnderTest);
    const user = userEvent.setup();
    const displayName = await screen.findByLabelText('Display name');
    const contact = screen.getByLabelText('Contact number (optional)');
    await user.type(displayName, '  Synthetic Member  ');
    await user.type(contact, '   ');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(gatewayUnderTest.updateMyMemberProfile).toHaveBeenCalledExactlyOnceWith({
      membershipId: profile.membershipId,
      displayName: 'Synthetic Member',
      contactNumber: '',
      expectedVersion: 1,
    });
    expect(displayName).toBeDisabled();
    expect(contact).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving profile' })).toBeDisabled();
    expect(screen.queryByText('Your organization profile was saved.')).not.toBeInTheDocument();
    await act(async () => {
      pending.resolve(completeProfile);
      await pending.promise;
    });
    expect(displayName).toBeEnabled();
    expect(displayName).toHaveValue(completeProfile.displayName);
    expect(contact).toHaveValue(completeProfile.contactNumber);
    expect(
      screen.queryByText('Complete your display name to finish this profile.'),
    ).not.toBeInTheDocument();
    await user.clear(contact);
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(gatewayUnderTest.updateMyMemberProfile).toHaveBeenLastCalledWith({
      membershipId: profile.membershipId,
      displayName: completeProfile.displayName,
      contactNumber: '',
      expectedVersion: 4,
    });
  });

  it.each([
    [
      new AuthGatewayError('member_administration_state_conflict', 'Refresh before trying again.'),
      'Refresh before trying again.',
    ],
    [
      new AuthGatewayError('member_administration_not_found', 'This profile is unavailable.'),
      'This profile is unavailable.',
    ],
    [new Error('private-save-diagnostic'), 'Your profile could not be verified. Try again.'],
  ])(
    'preserves entered values after a failed save without retrying or refreshing (%s)',
    async (failure, message) => {
      const gatewayUnderTest = gateway();
      gatewayUnderTest.updateMyMemberProfile.mockRejectedValue(failure);
      renderProfile(gatewayUnderTest);
      const user = userEvent.setup();
      const displayName = await screen.findByLabelText('Display name');
      const contact = screen.getByLabelText('Contact number (optional)');
      await user.type(displayName, 'Synthetic Member');
      await user.type(contact, '+63 2 555 0100');
      await user.click(screen.getByRole('button', { name: 'Save profile' }));
      expect(await screen.findByText(message)).toHaveAttribute('role', 'status');
      expect(displayName).toHaveValue('Synthetic Member');
      expect(contact).toHaveValue('+63 2 555 0100');
      expect(displayName).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Save profile' })).toBeEnabled();
      expect(screen.queryByText('private-save-diagnostic')).not.toBeInTheDocument();
      expect(screen.queryByText('Your organization profile was saved.')).not.toBeInTheDocument();
      expect(gatewayUnderTest.loadMyMemberProfile).toHaveBeenCalledOnce();
      expect(gatewayUnderTest.updateMyMemberProfile).toHaveBeenCalledOnce();
    },
  );

  it('keeps offline edits in memory and sends nothing until a manual online save', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const gatewayUnderTest = gateway();
    renderProfile(gatewayUnderTest);
    const user = userEvent.setup();
    const displayName = await screen.findByLabelText('Display name');
    await user.type(displayName, 'Synthetic Member');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(
      await screen.findByText(
        'You are offline. Profile changes are not queued; reconnect and try again.',
      ),
    ).toBeInTheDocument();
    expect(displayName).toHaveValue('Synthetic Member');
    expect(gatewayUnderTest.updateMyMemberProfile).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    await act(() => window.dispatchEvent(new Event('online')));
    expect(gatewayUnderTest.updateMyMemberProfile).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Your organization profile was saved.')).toBeInTheDocument();
    expect(gatewayUnderTest.updateMyMemberProfile).toHaveBeenCalledOnce();
  });

  it('clears validation and prior guidance when a corrected save starts', async () => {
    const gatewayUnderTest = gateway();
    const pending = deferred<Awaited<ReturnType<AuthGateway['updateMyMemberProfile']>>>();
    gatewayUnderTest.updateMyMemberProfile.mockReturnValue(pending.promise);
    renderProfile(gatewayUnderTest);
    const user = userEvent.setup();
    const displayName = await screen.findByLabelText('Display name');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(screen.getByRole('alert')).toHaveFocus();
    await user.type(displayName, 'Synthetic Member');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(displayName).toHaveAttribute('aria-invalid', 'false');
    expect(displayName).toHaveAttribute('aria-describedby', 'member-display-name-guidance');
    expect(screen.queryByText('Review the highlighted profile fields.')).not.toBeInTheDocument();
    await act(async () => {
      pending.resolve(completeProfile);
      await pending.promise;
    });
  });

  it.each(['load', 'save'] as const)(
    'does not let a late %s response change a newly opened profile',
    async (operation) => {
      const gatewayUnderTest = gateway();
      const pending = deferred<Awaited<ReturnType<AuthGateway['loadMyMemberProfile']>>>();
      if (operation === 'load')
        gatewayUnderTest.loadMyMemberProfile.mockReturnValue(pending.promise);
      else gatewayUnderTest.updateMyMemberProfile.mockReturnValue(pending.promise);
      const first = renderProfile(gatewayUnderTest);
      if (operation === 'save') {
        const user = userEvent.setup();
        await user.type(await screen.findByLabelText('Display name'), 'Old Draft');
        await user.click(screen.getByRole('button', { name: 'Save profile' }));
      }
      first.unmount();
      const fresh = gateway();
      fresh.loadMyMemberProfile.mockResolvedValue(completeProfile);
      renderProfile(fresh);
      await screen.findByDisplayValue(completeProfile.displayName);
      await act(async () => {
        pending.resolve({ ...completeProfile, displayName: 'Obsolete Value' });
        await pending.promise;
      });
      expect(screen.getByLabelText('Display name')).toHaveValue(completeProfile.displayName);
      expect(screen.queryByText('Your organization profile was saved.')).not.toBeInTheDocument();
      expect(fresh.updateMyMemberProfile).not.toHaveBeenCalled();
    },
  );

  it('shows read-only account context and saves only bounded profile fields', async () => {
    const gatewayUnderTest = gateway();
    const user = userEvent.setup();
    render(
      <MemberProfilePanel
        gateway={gatewayUnderTest.value}
        membershipId={profile.membershipId}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('member@example.test')).toBeInTheDocument();
    expect(
      screen.getByText('Complete your display name to finish this profile.'),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Display name'), 'Synthetic Member');
    await user.type(screen.getByLabelText('Contact number (optional)'), '+63 2 555 0100');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() =>
      expect(gatewayUnderTest.updateMyMemberProfile).toHaveBeenCalledWith({
        membershipId: profile.membershipId,
        displayName: 'Synthetic Member',
        contactNumber: '+63 2 555 0100',
        expectedVersion: 1,
      }),
    );
    expect(await screen.findByText('Your organization profile was saved.')).toBeInTheDocument();
  });

  it('keeps invalid values in memory and does not send them', async () => {
    const gatewayUnderTest = gateway();
    const user = userEvent.setup();
    render(
      <MemberProfilePanel
        gateway={gatewayUnderTest.value}
        membershipId={profile.membershipId}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('member@example.test');
    await user.type(screen.getByLabelText('Display name'), 'X');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    const validationError = await screen.findByRole('link', {
      name: 'Enter 2 to 80 characters.',
    });
    expect(validationError).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveFocus();
    const displayName = screen.getByLabelText('Display name');
    expect(displayName).toHaveValue('X');
    expect(displayName).toHaveAttribute('aria-invalid', 'true');
    await user.click(validationError);
    expect(displayName).toHaveFocus();
    expect(gatewayUnderTest.updateMyMemberProfile).not.toHaveBeenCalled();
  });

  it('links an invalid contact number to its field without clearing either value', async () => {
    const gatewayUnderTest = gateway();
    const user = userEvent.setup();
    render(
      <MemberProfilePanel
        gateway={gatewayUnderTest.value}
        membershipId={profile.membershipId}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('member@example.test');
    await user.type(screen.getByLabelText('Display name'), 'Synthetic Member');
    await user.type(screen.getByLabelText('Contact number (optional)'), 'invalid-contact');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    const validationError = await screen.findByRole('link', {
      name: 'Use only digits, spaces, +, -, parentheses, and periods.',
    });
    const contactNumber = screen.getByLabelText('Contact number (optional)');
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(contactNumber).toHaveValue('invalid-contact');
    expect(contactNumber).toHaveAttribute('aria-invalid', 'true');
    expect(contactNumber).toHaveAttribute(
      'aria-describedby',
      'member-contact-number-guidance member-contact-number-error',
    );
    await user.click(validationError);
    expect(contactNumber).toHaveFocus();
    expect(gatewayUnderTest.updateMyMemberProfile).not.toHaveBeenCalled();
  });
});
