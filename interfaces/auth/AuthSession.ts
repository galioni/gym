export interface AuthUserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface AuthSession {
  accessToken: string;
  user: AuthUserProfile;
}
