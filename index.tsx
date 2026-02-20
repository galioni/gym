import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { FeedbackProvider } from './features/feedback/context/FeedbackProvider';
import { AuthProvider } from './features/auth/context/AuthProvider';
import { AuthGate } from './features/auth/components/AuthGate/AuthGate';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AuthProvider>
      <FeedbackProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </FeedbackProvider>
    </AuthProvider>
  </React.StrictMode>
);
