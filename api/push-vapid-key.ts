import { getVapidKeys } from "./_lib/apiEnv.js";
import {
  ApiRequest,
  ApiResponse,
  handlePreflight,
  setCorsHeaders,
} from "./_lib/http.js";

export default function handler(req: ApiRequest, res: ApiResponse): void {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const keys = getVapidKeys();
  if (!keys) {
    res.status(501).json({ error: "Push notifications are not configured." });
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).json({ publicKey: keys.publicKey });
}
