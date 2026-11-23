import React from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { LoginForm } from '../../src/features/auth/components/LoginForm';
import { MfaForm } from '../../src/features/auth/components/MfaForm';
import { SupabaseAuthGateway } from '../../src/features/auth/services/auth-gateway';
import { CredentialPanel } from '../../src/features/credentials/CredentialPanel';

export function mount(url: string, key: string, organizationId: string, membershipId: string) {
  if (url !== 'http://127.0.0.1:58321') throw new Error('Local Auth required.');
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const gateway = new SupabaseAuthGateway(client);
  if (!gateway.credentialOwner) throw new Error('Local credential gateway required.');
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <LoginForm
      busy={false}
      onSubmit={async (request) => {
        await gateway.signIn(request);
        root.render(
          <MfaForm
            busy={false}
            onCancel={() => gateway.signOut()}
            onSubmit={async (code) => {
              await gateway.verifyTotp(code);
              if ((await gateway.getMfaAssurance()).currentLevel !== 'aal2')
                throw new Error('MFA required.');
              root.render(
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
            }}
          />,
        );
      }}
    />,
  );
}
