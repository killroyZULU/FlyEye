import { dashboardLabel, type AccessMembership } from '../../../lib/access-context';
import type { WorkspaceNavigationItem, WorkspaceView } from '../workspace-navigation';

type WorkspaceDashboardProps = {
  membership: AccessMembership;
  navigation: WorkspaceNavigationItem[];
  onNavigate: (view: WorkspaceView) => void;
};

export function WorkspaceDashboard({
  membership,
  navigation,
  onNavigate,
}: WorkspaceDashboardProps) {
  const destinations = navigation.filter((item) => item.view !== 'home');

  return (
    <div className="dashboard-layout">
      <header className="dashboard-introduction">
        <span className="eyebrow">Access verified</span>
        <h1>{dashboardLabel(membership.role, membership.roleLabel)}</h1>
        <p>
          Signed in to <strong>{membership.organizationName}</strong>. Your dashboard shows only the
          tools currently available to your server-approved role.
        </p>
      </header>

      <section className="dashboard-workspace" aria-labelledby="available-workspace-heading">
        <div className="dashboard-section-heading">
          <span>Available workspace</span>
          <h2 id="available-workspace-heading">Continue your work</h2>
          <p>
            Choose a destination. Additional areas appear only when they are implemented and
            approved.
          </p>
        </div>

        <ul className="dashboard-destinations">
          {destinations.map((item, index) => (
            <li key={item.view}>
              <button type="button" onClick={() => onNavigate(item.view)}>
                <span className="dashboard-destination__index" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="dashboard-destination__copy">
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <span className="dashboard-destination__arrow" aria-hidden="true">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <aside className="dashboard-access" aria-label="Current access summary">
        <div>
          <span>Current role</span>
          <strong>{membership.roleLabel}</strong>
        </div>
        <div>
          <span>Membership</span>
          <strong>Active and verified</strong>
        </div>
        <p>Navigation helps you find approved tools. Server checks remain authoritative.</p>
      </aside>
    </div>
  );
}
