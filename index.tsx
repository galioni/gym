import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { FeedbackProvider } from './features/feedback/context/FeedbackProvider';
import { AuthProvider } from './features/auth/context/AuthProvider';
import { AuthGate } from './features/auth/components/AuthGate/AuthGate';
import { ErrorBoundary } from './components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <FeedbackProvider>
          <AuthGate>
            <App />
          </AuthGate>
          {/* Production only: dev and the local gym-app stack must not call out or skew analytics. */}
          {import.meta.env.PROD && <Analytics />}
          {import.meta.env.PROD && <SpeedInsights />}
        </FeedbackProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
