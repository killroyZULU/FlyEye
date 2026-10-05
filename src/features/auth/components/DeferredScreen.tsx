import { Component, Suspense, type ReactNode } from 'react';
import { StatePanel } from './StatePanel';

type DeferredScreenProps = {
  children: ReactNode;
  onLeave?: () => void;
  leaveLabel?: string;
};

// A rejected import remains cached by React. Reload explicitly; never retry commands.
export class DeferredScreen extends Component<DeferredScreenProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  renderStatus(failed: boolean) {
    return (
      <StatePanel
        eyebrow="FlyEye"
        title={failed ? 'This screen could not load' : 'Loading this screen'}
        tone={failed ? 'warning' : 'neutral'}
      >
        <p>
          {failed
            ? 'Check your connection, then reload to try again.'
            : 'Please wait while the screen opens.'}
        </p>
        {failed ? (
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>
            Reload page
          </button>
        ) : null}
        {this.props.onLeave ? (
          <button type="button" className="text-button" onClick={this.props.onLeave}>
            {this.props.leaveLabel ?? 'Back to workspace'}
          </button>
        ) : null}
      </StatePanel>
    );
  }

  render() {
    if (this.state.failed) return this.renderStatus(true);
    return <Suspense fallback={this.renderStatus(false)}>{this.props.children}</Suspense>;
  }
}
