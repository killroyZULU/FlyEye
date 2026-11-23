import React from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { CredentialPanel } from '../../src/features/credentials/CredentialPanel';
import { createOwnerGateway } from '../../src/features/credentials/owner-gateway';
import { MemberAdministrationGateway } from '../../src/features/auth/services/member-administration-gateway';
import type { Database } from '../../src/lib/database.types';

export async function mount(
  url: string,
  key: string,
  session: { access_token: string; refresh_token: string },
  organizationId: string,
  membershipId: string,
) {
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  if (!session?.access_token || !session.refresh_token)
    throw new Error('[credential-mount:missing-session]');
  const { error } = await client.auth.setSession(session);
  if (error) {
    const code = error.status ?? 0;
    const category = code >= 500 ? 'auth-5xx' : code >= 400 ? 'auth-4xx' : 'auth-unavailable';
    throw new Error('[credential-mount:' + category + ']');
  }
  const metadata = new MemberAdministrationGateway(client);
  const gateway = {
    credentialWorkspace: metadata.credentialWorkspace.bind(metadata),
    credentialOwner: createOwnerGateway(client),
    getMfaAssurance: async () => {
      const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error || !data) throw new Error('Assurance unavailable.');
      return data;
    },
    verifyTotp: () =>
      Promise.reject(new Error('This check exercises an already MFA-authenticated owner.')),
  };
  createRoot(document.getElementById('root')!).render(
    <CredentialPanel
      gateway={gateway}
      personnel={false}
      membership={{
        organizationId,
        membershipId,
        organizationName: 'Synthetic school',
        role: 'student_pilot',
        roleLabel: 'Student',
        workspacePermission: 'portal.student.access',
        permissions: ['credential.own.read'],
        membershipVersion: 1,
        requiredAssuranceLevel: 'aal1',
        accessStatus: 'granted',
      }}
    />,
  );
}
