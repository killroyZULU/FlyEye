import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CredentialPanel } from './CredentialPanel';
import type { CredentialResult } from './workspace';
import type { AccessMembership } from '../../lib/access-context';
import { workspaceNavigation } from '../auth/workspace-navigation';

const membership: AccessMembership = {
  membershipId: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  organizationName: 'Synthetic school',
  role: 'student_pilot',
  roleLabel: 'Student Pilot',
  workspacePermission: 'portal.student.access',
  permissions: ['credential.own.read'],
  membershipVersion: 1,
  requiredAssuranceLevel: 'aal1',
  accessStatus: 'granted',
};
function result(
  applicability: CredentialResult['members'][number]['applicability'],
): CredentialResult {
  return {
    decision: 'credential_workspace',
    organizationId: membership.organizationId,
    correlationId: membership.membershipId,
    hasMore: false,
    members: [
      {
        membershipId: membership.membershipId,
        version: 2,
        displayName: 'Synthetic member',
        applicability,
      },
    ],
  };
}
describe('credential workspace', () => {
  it.each(['trainee', 'instructor', 'both'] as const)(
    'shows one applicable set for %s',
    async (applicability) => {
      const gateway = { credentialWorkspace: vi.fn().mockResolvedValue(result(applicability)) };
      render(<CredentialPanel gateway={gateway} membership={membership} personnel={false} />);
      expect(screen.getByRole('status')).toHaveTextContent('Loading');
      expect(await screen.findByText('No credentials on record.')).toBeVisible();
      expect(screen.getAllByRole('listitem')).toHaveLength(applicability === 'trainee' ? 4 : 6);
      expect(screen.getByText(/NTC radio license/)).toHaveTextContent(
        applicability === 'trainee' ? 'not yet obtained' : 'required',
      );
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(gateway.credentialWorkspace).toHaveBeenCalledWith({
        action: 'my_credentials',
        organizationId: membership.organizationId,
        membershipId: membership.membershipId,
      });
    },
  );
  it('shows explicit unassigned applicability', async () => {
    render(
      <CredentialPanel
        gateway={{ credentialWorkspace: vi.fn().mockResolvedValue(result(null)) }}
        membership={membership}
        personnel={false}
      />,
    );
    expect(await screen.findByText(/has not set/)).toBeVisible();
    expect(screen.queryByRole('listitem')).toBeNull();
  });
  it('keeps navigation and personnel editing permission-based', async () => {
    const staff = { ...membership, permissions: ['credential.school.read'] };
    expect(workspaceNavigation(membership).map((x) => x.view)).toContain('myCredentials');
    expect(workspaceNavigation(membership).map((x) => x.view)).not.toContain(
      'personnelCredentials',
    );
    expect(workspaceNavigation(staff).map((x) => x.view)).toContain('personnelCredentials');
    const gateway = { credentialWorkspace: vi.fn().mockResolvedValue(result('both')) };
    const { rerender } = render(<CredentialPanel gateway={gateway} membership={staff} personnel />);
    expect(await screen.findByText('Synthetic member')).toBeVisible();
    expect(screen.queryByRole('combobox')).toBeNull();
    rerender(
      <CredentialPanel
        gateway={gateway}
        membership={{
          ...staff,
          permissions: [...staff.permissions, 'credential.applicability.manage'],
        }}
        personnel
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'trainee' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save applicability' }));
    await waitFor(() =>
      expect(gateway.credentialWorkspace).toHaveBeenCalledWith({
        action: 'set_credential_applicability',
        organizationId: staff.organizationId,
        membershipId: staff.membershipId,
        applicability: 'trainee',
        expectedVersion: 2,
      }),
    );
  });
  it('renders a denied response without personnel data', async () => {
    render(
      <CredentialPanel
        gateway={{ credentialWorkspace: vi.fn().mockRejectedValue(new Error('Access denied')) }}
        membership={membership}
        personnel
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
