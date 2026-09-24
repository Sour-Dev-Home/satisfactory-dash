import { Component, createRef, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** What the operator calls this part of the page, e.g. "Power". */
  label: string;
  /** Extra controls for the fallback, e.g. Log out when the crash hides the real one. */
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
  }

  componentDidUpdate(): void {
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
    return (
      <section ref={this.notice} tabIndex={-1} role="alert" aria-label={`${this.props.label} error`}>
        <p>{this.props.label} hit an error and couldn't be shown.</p>
        <button type="button" onClick={this.retry}>
          Try again
        </button>
        {this.props.actions}
      </section>
    );
  }
}
