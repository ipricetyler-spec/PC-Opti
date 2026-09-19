import { Component, type ErrorInfo, type ReactNode } from 'react';

export class WorkspaceErrorBoundary extends Component<{ children: ReactNode; onRecover?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Do not persist component props or local device identities in error reports.
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section role="alert" className="m-5 rounded-xl border border-amber-500/40 bg-slate-950 p-6 text-slate-100">
      <h1 className="text-lg font-bold">This view could not be displayed</h1>
      <p className="mt-2 text-sm">Nothing you saved was lost. This was a display error, so it does not tell us whether the last change finished. Check Restore › Recovery & history before trying it again.</p>
      <button type="button" className="mt-4 rounded border border-cyan-400 px-4 py-2" onClick={() => {
        if (this.props.onRecover) { this.props.onRecover(); this.setState({ failed: false }); }
        else window.location.reload();
      }}>{this.props.onRecover ? 'Open recovery' : 'Reload and read saved status'}</button>
    </section>;
  }
}
