/**
 * Supplies bearer tokens for infrastructure adapters that call authenticated APIs.
 */
export interface AuthTokenProvider {
  getAccessToken(): Promise<string | null>;
}
