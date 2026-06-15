import type { RequiredVercelKvEnv, AiProvider } from "./apiEnv.js";

export interface UserSettings {
  aiProvider?: AiProvider;
}

async function kvPipeline(
  kvEnv: RequiredVercelKvEnv,
  commands: unknown[][]
): Promise<unknown[]> {
  const response = await fetch(`${kvEnv.kvRestApiUrl}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kvEnv.kvRestApiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  if (!response.ok) throw new Error(`KV pipeline failed: ${response.status}`);
  return response.json() as Promise<unknown[]>;
}

const key = (userId: string) => `user_settings:${userId}`;

export async function getUserSettings(
  userId: string,
  kvEnv: RequiredVercelKvEnv
): Promise<UserSettings> {
  try {
    const results = await kvPipeline(kvEnv, [["GET", key(userId)]]);
    const raw = (results[0] as { result: string | null }).result;
    if (!raw) return {};
    return JSON.parse(raw) as UserSettings;
  } catch {
    return {};
  }
}

export async function setUserSettings(
  userId: string,
  settings: UserSettings,
  kvEnv: RequiredVercelKvEnv
): Promise<void> {
  await kvPipeline(kvEnv, [["SET", key(userId), JSON.stringify(settings)]]);
}
