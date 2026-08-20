/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    css: true,
    coverage: {
      exclude: [
        '**/*.test.{ts,tsx}',
        'src/lib/database.types.ts',
        'src/main.tsx',
        'src/test/**',
        'src/vite-env.d.ts',
        'supabase/functions/**/index.ts',
      ],
      include: ['src/**/*.{ts,tsx}', 'supabase/functions/**/*.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        branches: 67,
        functions: 75,
        lines: 74,
        statements: 71,
      },
    },
  },
});
