import React from "react";

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  copied: boolean;
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
    this.state = { error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    // Log in all environments so production crashes surface in Vercel Function Logs.
    console.error("[ErrorBoundary] Unhandled render error", {
      error: error.message,
      stack: import.meta.env.DEV ? error.stack : undefined,
      componentStack: import.meta.env.DEV ? errorInfo.componentStack : undefined,
    });
  }

  private handleCopy = () => {
    const { error, errorInfo } = this.state;
    const details = [
      `Error: ${error?.message ?? "Unknown"}`,
      error?.stack ? `\nStack:\n${error.stack}` : "",
      errorInfo?.componentStack ? `\nComponent stack:${errorInfo.componentStack}` : "",
    ].join("");
    navigator.clipboard.writeText(details).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  override render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background text-slate-200 flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <h1 className="text-xl font-semibold text-white">Something went wrong</h1>
            <p className="text-sm text-slate-400 font-mono break-words bg-white/5 rounded-xl px-4 py-3 text-left">
              {this.state.error.message}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                className="px-4 py-2 bg-primary/80 hover:bg-primary rounded-xl text-sm text-white transition-colors"
                onClick={() => window.location.reload()}
              >
                Reload App
              </button>
              <button
                className="px-4 py-2 bg-white/10 hover:bg-white/15 rounded-xl text-sm text-slate-300 transition-colors"
                onClick={this.handleCopy}
              >
                {this.state.copied ? "Copied!" : "Copy error details"}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
