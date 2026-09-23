import { useEffect, useRef, type ReactNode } from 'react';

import type { AccessMembership } from '../../../lib/access-context';
import type { WorkspaceNavigationItem, WorkspaceView } from '../workspace-navigation';

type AuthenticatedShellProps = {
  membership: AccessMembership;
  currentView: WorkspaceView;
  navigation: WorkspaceNavigationItem[];
  onNavigate: (view: WorkspaceView) => void;
  onSignOut: () => void;
  children: ReactNode;
};

export function AuthenticatedShell({
  membership,
  currentView,
  navigation,
  onNavigate,
  onSignOut,
  children,
}: AuthenticatedShellProps) {
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.focus();
  }, [currentView]);

  return (
    <div className="application-shell">
      <a className="skip-link" href="#workspace-main">
        Skip to workspace content
      </a>
      <header className="application-header">
        <div className="application-header__inner">
          <div className="application-brand" aria-label="FlyEye">
            <span className="application-brand__mark" aria-hidden="true">
              F
            </span>
            <span>
              <strong>FlyEye</strong>
              <small>Training clarity. Operational discipline.</small>
            </span>
          </div>

          <div className="school-context">
            <span>School workspace</span>
            <strong>{membership.organizationName}</strong>
          </div>

          <div className="account-context">
            <span>{membership.roleLabel}</span>
            <button type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <nav className="primary-navigation" aria-label="Primary navigation">
        <div className="primary-navigation__inner">
          {navigation.map((item) => (
            <button
              key={item.view}
              className="primary-navigation__item"
              type="button"
              aria-current={currentView === item.view ? 'page' : undefined}
              onClick={() => onNavigate(item.view)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      <main id="workspace-main" className="application-main" tabIndex={-1} ref={mainRef}>
        {children}
      </main>

      <footer className="application-footer">
        <span>Private flight-school system</span>
        <span aria-hidden="true">•</span>
        <span>Authorized users only</span>
      </footer>
    </div>
  );
}
