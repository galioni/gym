import { ApiRequest, ApiResponse, toBearerToken } from "./http.js";
import { verifySupabaseJwt } from "./verifySupabaseJwt.js";

export interface AuthContext {
  userId: string;
  email: string | null;
  accessToken: string;
}

export async function requireAuth(
  req: ApiRequest,
  res: ApiResponse
): Promise<AuthContext | null> {
  const accessToken = toBearerToken(req.headers?.authorization);
  if (!accessToken) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const user = await verifySupabaseJwt(accessToken);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  return {
    userId: user.id,
    email: user.email,
    accessToken,
  };
}
