import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const maintainabilityRules = {
  complexity: ['error', { max: 20 }],
  'max-depth': ['error', 5],
  'max-lines-per-function': [
    'error',
    { IIFEs: true, max: 200, skipBlankLines: true, skipComments: true },
  ],
  'max-nested-callbacks': ['error', 4],
  'max-params': ['error', 6],
};

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'src/lib/database.types.ts'],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['**/*.{ts,tsx}'],
    ignores: ['supabase/functions/**/index.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'supabase/functions/**/*.ts'],
    ignores: ['**/*.test.{ts,tsx}', 'src/lib/database.types.ts', 'supabase/functions/**/index.ts'],
    rules: maintainabilityRules,
  },
  ...tseslint.configs.recommended.map((configuration) => ({
    ...configuration,
    files: ['supabase/functions/**/index.ts'],
    languageOptions: {
      ...configuration.languageOptions,
      ecmaVersion: 2023,
      globals: globals.denoBuiltin,
      parserOptions: { project: false },
    },
  })),
  {
    files: ['supabase/functions/**/index.ts'],
    rules: {
      ...js.configs.recommended.rules,
      ...maintainabilityRules,
      'no-array-constructor': 'off',
      'no-unused-expressions': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: [
      'src/features/auth/AuthApp.tsx',
      'src/features/auth/components/AdminOnboardingFlow.tsx',
      'src/features/auth/components/MemberInvitationsPanel.tsx',
      'src/features/auth/components/MemberMfaEnrollmentFlow.tsx',
      'src/features/auth/components/PasswordRecoveryFlow.tsx',
      'src/features/auth/services/auth-gateway.ts',
      'src/features/members/components/MemberAdministrationPanel.tsx',
      'src/features/members/components/MemberProfilePanel.tsx',
      'supabase/functions/auth-bootstrap/handler.ts',
      'supabase/functions/member-administration/handler.ts',
      'supabase/functions/member-invitations/handler.ts',
      'supabase/functions/member-mfa/handler.ts',
      'supabase/functions/organization-admin-onboarding/handler.ts',
    ],
    rules: {
      complexity: 'off',
      'max-lines-per-function': 'off',
    },
  },
);
