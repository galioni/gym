/**
 * Local stand-in for `vercel dev`: serves every handler in /api at /api/<name>.
 *
 * Mirrors the slice of the Vercel Node runtime the handlers rely on:
 *   - default export `(req, res)`; req.method / req.headers / req.body
 *   - res.status(code) -> res, res.json(payload), res.setHeader
 *   - `export const config = { api: { bodyParser: false } }` leaves the request stream untouched
 * CORS and preflight are handled by the handlers themselves (see api/_lib/http.ts).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (payload: unknown) => void;
};
type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;
interface HandlerModule {
  default: Handler;
  config?: { api?: { bodyParser?: boolean } };
}

const PORT = Number(process.env.GYM_API_PORT ?? 3010);
const API_DIR = path.resolve(fileURLToPath(new URL("../../api", import.meta.url)));
const ROUTE = /^\/api\/([a-z][a-z0-9-]*)\/?$/;

const modules = new Map<string, Promise<HandlerModule>>();

function loadHandler(name: string): Promise<HandlerModule> | null {
  const file = path.join(API_DIR, `${name}.ts`);
  if (!existsSync(file)) return null;
  let loaded = modules.get(name);
  if (!loaded) {
    loaded = import(pathToFileURL(file).href) as Promise<HandlerModule>;
    modules.set(name, loaded);
  }
  return loaded;
}

function decorate(res: ServerResponse): VercelResponse {
  const decorated = res as VercelResponse;
  decorated.status = (code) => {
    res.statusCode = code;
    return decorated;
  };
  decorated.json = (payload) => {
    if (!res.hasHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  };
  return decorated;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks).toString("utf8");
}

function sendError(res: VercelResponse, status: number, message: string): void {
  res.status(status).json({ error: message });
}

const server = createServer((incoming, outgoing) => {
  const req = incoming as VercelRequest;
  const res = decorate(outgoing);

  void (async () => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://localhost");
    const match = ROUTE.exec(url.pathname);
    const loading = match ? loadHandler(match[1]) : null;
    if (!match || !loading) {
      sendError(res, 404, `No handler for ${url.pathname}`);
      return;
    }

    try {
      const mod = await loading;
      if (mod.config?.api?.bodyParser !== false) {
        const raw = await readBody(req);
        if (raw.length > 0) {
          if ((req.headers["content-type"] ?? "").includes("application/json")) {
            try {
              req.body = JSON.parse(raw) as unknown;
            } catch {
              sendError(res, 400, "Invalid JSON body");
              return;
            }
          } else {
            req.body = raw;
          }
        }
      }
      await mod.default(req, res);
    } catch (error) {
      console.error(`[api] ${req.method} ${url.pathname} failed:`, error);
      if (!res.headersSent) sendError(res, 500, "Internal server error");
      else res.end();
    } finally {
      console.log(`[api] ${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - started}ms)`);
    }
  })();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[api] gym-app local API listening on :${PORT} (handlers: ${API_DIR})`);
});
