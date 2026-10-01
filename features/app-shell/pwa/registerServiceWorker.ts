import { registerSW } from "virtual:pwa-register";
import type { RegisterServiceWorker } from "./usePwaUpdate";

/**
 * The only file that touches the generated `virtual:pwa-register` module, so everything else (and the tests)
 * can run without the PWA plugin.
 */
export const registerServiceWorker: RegisterServiceWorker = ({ onNeedRefresh, onRegistered }) =>
  registerSW({
    onNeedRefresh,
    onRegisteredSW: (_url, registration) => onRegistered(registration),
  });
