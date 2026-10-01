import { useCallback, useEffect, useRef, useState } from "react";

export interface ServiceWorkerHandlers {
  /** A new build finished installing and is waiting for the user to switch to it. */
  onNeedRefresh: () => void;
  onRegistered: (registration: ServiceWorkerRegistration | undefined) => void;
}

/** Registers the service worker; returns a function that activates a waiting worker and reloads. */
export type RegisterServiceWorker = (handlers: ServiceWorkerHandlers) => (reloadPage?: boolean) => Promise<void>;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Tells the UI when a new version of the app is ready, and switches to it on request.
 *
 * An installed PWA can stay open for days, so the browser's own once-per-navigation update check is not enough:
 * this also asks for the latest worker every hour and whenever the app comes back to the foreground.
 */
export function usePwaUpdate(register: RegisterServiceWorker, checkIntervalMs = HOUR_MS) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const activateRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);

  useEffect(() => {
    // Strict mode runs effects twice in development; register once.
    activateRef.current ??= register({
      onNeedRefresh: () => setUpdateAvailable(true),
      onRegistered: (registration) => {
        registrationRef.current = registration;
      },
    });

    const checkForUpdate = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      registrationRef.current?.update().catch(() => {
        // Offline or the server is briefly unreachable: try again at the next check.
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };

    const timer = window.setInterval(checkForUpdate, checkIntervalMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [register, checkIntervalMs]);

  const applyUpdate = useCallback(() => {
    void activateRef.current?.(true);
  }, []);

  return { updateAvailable, applyUpdate };
}
