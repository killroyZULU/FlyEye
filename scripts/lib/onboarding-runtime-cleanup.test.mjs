import { describe, expect, it } from 'vitest';
import { createFixtureDiagnostics } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';
import { runOnboardingCleanup } from './onboarding-runtime-cleanup.mjs';

describe('onboarding cleanup evidence', () => {
  it('keeps a failed browser stage active while independent shutdown runs', async () => {
    const lines = [];
    const diagnostics = createFixtureDiagnostics('FEAT-003', {
      enabled: true,
      write: (line) => lines.push(line),
    });
    diagnostics.enter('browser-totp-completion');
    // The browser finally block shuts down before the outer catch reports failure.
    await diagnostics.run('browser-frontend-shutdown', async () => {});
    diagnostics.fail(new Error('synthetic-sensitive-value'));
    expect(lines).toContain(
      'FEAT-003 runtime diagnostic: stage=browser-totp-completion event=failed detail=unclassified.',
    );
    expect(lines).not.toContain(
      'FEAT-003 runtime diagnostic: stage=browser-totp-completion event=passed.',
    );
  });
  const stages = [
    'cleanup-edge-shutdown',
    'cleanup-domain-rows',
    'cleanup-auth-users',
    'cleanup-assertions',
    'cleanup-temporary-files',
  ];
  it.each(stages)('continues after %s fails and rejects partial cleanup', async (failedStage) => {
    const lines = [];
    const visited = [];
    const diagnostics = createFixtureDiagnostics('FEAT-003', {
      enabled: true,
      write: (line) => lines.push(line),
    });
    await expect(
      runOnboardingCleanup(
        diagnostics,
        stages.map((stage) => [
          stage,
          async () => {
            visited.push(stage);
            if (stage === failedStage) throw new Error('synthetic-sensitive-value');
          },
        ]),
      ),
    ).rejects.toThrow('Synthetic onboarding cleanup failed.');
    expect(visited).toEqual(stages);
    expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', lines.join('\n'))).toEqual(lines);
    expect(lines.join('\n')).not.toContain('synthetic-sensitive-value');
    expect(lines).toContain(
      `FEAT-003 runtime diagnostic: stage=${failedStage} event=failed detail=unclassified.`,
    );
    expect(lines).not.toContain(`FEAT-003 runtime diagnostic: stage=${failedStage} event=passed.`);
  });
  it('reports successful steps and rejects arbitrary failure output', async () => {
    const lines = [];
    const diagnostics = createFixtureDiagnostics('FEAT-003', {
      enabled: true,
      write: (line) => lines.push(line),
    });
    await runOnboardingCleanup(
      diagnostics,
      stages.map((stage) => [stage, async () => {}]),
    );
    expect(lines.filter((line) => line.includes('event=passed'))).toHaveLength(stages.length);
    const rejected = [
      'FEAT-003 runtime diagnostic: stage=synthetic-secret event=enter.',
      'FEAT-003 runtime diagnostic: stage=completion-race event=failed detail=synthetic-secret.',
    ];
    expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', rejected.join('\n'))).toEqual([]);
  });
});
