import { ApiRequest, ApiResponse, setCorsHeaders, handlePreflight } from "./_lib/http.js";
import { getEnabledProviders } from "./_lib/apiEnv.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  res.status(200).json({ enabledProviders: getEnabledProviders() });
}
