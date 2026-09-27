import { Component, createRef, type ErrorInfo, type ReactNode } from "react";
import { isChunkLoadError, reloadOnce } from "../lib/staleChunk";

interface Props {
  /** What the operator calls this part of the page, e.g. "Power". */
  label: string;
  /** Extra controls for the fallback, e.g. Sign out when the crash hides the account menu. */
  actions?: ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Contains a render crash to one part of the page, so the rest of the dashboard and the
 * footer (the AGPL source link, ADR-0018) keep working. Shows no error details; the error
 * goes to the console. "Try again" re-renders the part and moves focus to it (or back to
 * the notice if it fails again), since the button focus was on is gone.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  private retried = false;
  private content = createRef<HTMLDivElement>();
  private notice = createRef<HTMLElement>();

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label}] failed to render`, error, info.componentStack);
    // A chunk a deploy removed (#325): reload once. vite:preloadError usually got there first,
    // and then the guard makes this a no-op.
    if (isChunkLoadError(error)) reloadOnce();
  }

  /** Whether focus is inside the part, so a crash that unmounts it doesn't drop focus on <body>. */
  getSnapshotBeforeUpdate(): boolean {
    return !!this.content.current?.contains(document.activeElement);
  }

  componentDidUpdate(_props: Props, prev: State, focusWasInside: boolean): void {
    if (!prev.error && this.state.error && focusWasInside) this.notice.current?.focus();
    if (!this.retried) return;
    this.retried = false;
    (this.state.error ? this.notice : this.content).current?.focus();
  }

  private retry = () => {
    this.retried = true;
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) {
      return (
        <div ref={this.content} tabIndex={-1}>
          {this.props.children}
        </div>
      );
    }
    // Try again can't fetch a chunk that no longer exists; only a reload gets the new version.
    const stale = isChunkLoadError(this.state.error);
    return (
      <section ref={this.notice} tabIndex={-1} role="alert" aria-label={`${this.props.label} error`}>
        <p>
          {stale
            ? "A new version of the dashboard is available. Reload the page to see it."
            : `${this.props.label} hit an error and couldn't be shown.`}
        </p>
        <button type="button" onClick={stale ? () => window.location.reload() : this.retry}>
          {stale ? "Reload" : "Try again"}
        </button>
        {this.props.actions}
      </section>
    );
  }
}
