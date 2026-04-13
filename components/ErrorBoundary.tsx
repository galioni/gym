import React from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches unhandled render errors and shows a recovery UI instead of a blank page.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background text-slate-200 flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <h1 className="text-xl font-semibold text-white">Something went wrong</h1>
            <p className="text-sm text-slate-400 font-mono break-words">
              {this.state.error.message}
            </p>
            <button
              className="px-4 py-2 bg-primary/80 hover:bg-primary rounded-xl text-sm text-white transition-colors"
              onClick={() => window.location.reload()}
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
