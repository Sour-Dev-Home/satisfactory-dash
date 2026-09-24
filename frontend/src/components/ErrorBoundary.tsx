import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** What the operator calls this part of the page, e.g. "Power". */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Contains a render crash to one part of the page, so the rest of the dashboard and the
 * footer (the AGPL source link, ADR-0018) keep working. Shows no error details; the error
 * goes to the console. "Try again" re-renders the part.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label}] failed to render`, error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section role="alert" aria-label={`${this.props.label} error`}>
        <p>{this.props.label} hit an error and couldn't be shown.</p>
        <button type="button" onClick={this.retry}>
          Try again
        </button>
      </section>
    );
  }
}
