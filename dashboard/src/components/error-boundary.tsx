import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="beast-error-state">
          <p className="beast-error-state-title">Something went wrong</p>
          <p className="beast-error-state-message">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="beast-btn beast-btn-outline beast-btn-sm beast-mt-lg"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
