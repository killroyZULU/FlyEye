import { describe, it, expect, vi } from 'vitest';
import { inventory, differences, ownedGuard } from './credential-proof-receipt.mjs';
describe('private disposable inventory receipt', () => {
  it('keeps only hashed identifiers and distinguishes a changed state from added or removed resources', () => {
    const snap = (state, volume) =>
      inventory((kind) =>
        kind === 'ps' ? 'privateContainer ' + state : kind === 'volume' ? volume : 'privateNetwork',
      );
    const a = snap('running', 'sensitiveVolume'),
      b = snap('exited', 'differentVolume');
    expect(JSON.stringify(a)).not.toMatch(/privateContainer|privateNetwork|sensitiveVolume/);
    const delta = differences(a, b);
    expect(delta.containers.changed).toHaveLength(1);
    expect(delta.volumes.added).toHaveLength(1);
    expect(delta.volumes.removed).toHaveLength(1);
    expect(delta.networks.added).toHaveLength(0);
    expect(differences(a, a).containers.changed).toHaveLength(0);
  });
  it('does not remove anything without the full ownership receipt', () => {
    const docker = vi.fn();
    const guard = ownedGuard({ id: 'proof' }, {}, docker);
    expect(() => guard.close()).toThrow();
    expect(docker).not.toHaveBeenCalled();
  });
  it('rejects a substituted network before inspecting or removing containers', () => {
    const id = 'f'.repeat(64),
      docker = vi.fn(() => JSON.stringify([{ Name: 'unrelated', Labels: {} }]));
    const guard = ownedGuard({ id: 'proof' }, { networks: [] }, docker);
    guard.networkCreated(id);
    expect(() => guard.capture()).toThrow();
    expect(() => guard.close()).toThrow();
    expect(docker.mock.calls).toEqual([['network', 'inspect', id]]);
  });
  it('rejects an unattached labeled volume without deleting it', () => {
    const network = 'flyeye-nosend-p3d1-isolated',
      net = 'e'.repeat(64),
      project = 'flyeye-nosend-p3d1';
    const containers = ['auth', 'db', 'inbucket', 'kong', 'rest'].map((name, i) => ({
      Id: String(i + 1).repeat(64),
      Name: '/supabase_' + name + '_' + project,
      Config: { Labels: { 'com.supabase.cli.project': project } },
      NetworkSettings: { Networks: { [network]: { NetworkID: net } } },
      Mounts: [],
    }));
    const ids = containers.map((c) => c.Id);
    const docker = vi.fn((...args) => {
      if (args[0] === 'network')
        return JSON.stringify([
          {
            Name: network,
            Labels: { 'flyeye.s2.run': 'proof' },
            Containers: Object.fromEntries(ids.map((id) => [id, {}])),
          },
        ]);
      if (args[0] === 'ps') return ids.join('\n');
      if (args[0] === 'inspect') return JSON.stringify(containers);
      if (args[0] === 'volume' && args[1] === 'ls') return 'unattached';
      throw Error('unexpected command');
    });
    const guard = ownedGuard(
      { id: 'proof' },
      { containers: {}, volumes: [], networks: [] },
      docker,
    );
    guard.networkCreated(net);
    expect(() => guard.capture()).toThrow(/Unattributed/);
    expect(() => guard.close()).toThrow();
    expect(docker.mock.calls.flat()).not.toContain('rm');
  });
});
