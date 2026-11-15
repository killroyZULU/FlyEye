const onboarding = 'test-feat-003-runtime.mjs';
const staleFlags = new Set(['--stale-cleanup-probe', '--stale-factors']);

// One inventory for the default route and both mandatory CI partitions.
export function fixtureModes(fixture, provider) {
  if (fixture === onboarding && provider)
    return [
      ['--current-factor-cleanup-probe'],
      ['--current-factor'],
      ['--uncertainty-cleanup-probe'],
      ['--provider-uncertainty'],
      ['--churn-cleanup-probe'],
      ['--factor-churn'],
      [],
      ['--provider-cleanup-probe'],
      ['--provider-state'],
      ['--stale-cleanup-probe'],
      ['--stale-factors'],
      ['--challenge-cleanup-probe'],
      ['--verified-challenge'],
    ];
  if (fixture === 'test-feat-004-runtime.mjs' && provider)
    return [['--recipient-cleanup-probe'], []];
  if (fixture === 'test-feat-006-runtime.mjs')
    return [[], ['--browser', '--cleanup-probe'], ['--browser'], ['--browser', '--resume']];
  if (['test-edge-runtime.mjs', 'test-recovery-runtime.mjs'].includes(fixture))
    return [['--cleanup-probe'], []];
  return [[]];
}

export function matrixOptions(args) {
  let partition = 'full';
  let list = false;
  let selected = false;
  for (const argument of args) {
    if (argument === '--list' && !list) list = true;
    else if (/^--partition=(full|core|stale)$/.test(argument) && !selected) {
      partition = argument.slice('--partition='.length);
      selected = true;
    } else throw new Error('Invalid runtime matrix selection.');
  }
  return { partition, list };
}

const identity = ({ fixture, modeIndex }) => `${fixture}:${modeIndex}`;

export function requireCompletePartitions(inventory, partitions) {
  const expected = new Map(inventory.map((scenario) => [identity(scenario), scenario]));
  if (!inventory.length || expected.size !== inventory.length || partitions.length !== 2)
    throw new Error('Invalid runtime matrix inventory.');
  const seen = new Set();
  for (const partition of partitions) {
    if (!partition.length) throw new Error('Empty runtime matrix partition.');
    for (const scenario of partition) {
      const id = identity(scenario);
      const original = expected.get(id);
      if (!original || seen.has(id) || JSON.stringify(original) !== JSON.stringify(scenario))
        throw new Error('Invalid or overlapping runtime matrix partition.');
      seen.add(id);
    }
  }
  if (seen.size !== expected.size) throw new Error('Incomplete runtime matrix partition.');
}

export function runtimePlan(fixtures, { provider, partition = 'full' }) {
  if (
    !['full', 'core', 'stale'].includes(partition) ||
    !fixtures.length ||
    new Set(fixtures).size !== fixtures.length ||
    fixtures.some((fixture) => !/^test-[a-z0-9-]+-runtime\.mjs$/.test(fixture))
  )
    throw new Error('Invalid runtime matrix selection.');
  const inventory = fixtures.flatMap((fixture) =>
    fixtureModes(fixture, provider).map((args, modeIndex) => ({ fixture, modeIndex, args })),
  );
  if (partition === 'full') return inventory;
  if (!provider) throw new Error('Runtime partitions require disposable GitHub CI.');
  const isStale = ({ fixture, args }) => fixture === onboarding && staleFlags.has(args[0]);
  const stale = inventory.filter(isStale);
  const core = inventory.filter((scenario) => !isStale(scenario));
  requireCompletePartitions(inventory, [core, stale]);
  return partition === 'core' ? core : stale;
}
