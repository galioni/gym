import { beforeEach, describe, expect, it, vi } from "vitest";

const created: Array<{ url: string; options: { params: { apikey: string }; accessToken: () => Promise<string | null> } }> = [];
const channels: Array<{ topic: string; config: unknown; handlers: Array<(payload: unknown) => void>; subscribed: boolean }> = [];
const disconnect = vi.fn();
let failConstruction = false;

vi.mock("@supabase/realtime-js", () => ({
  RealtimeClient: class {
    public constructor(url: string, options: (typeof created)[number]["options"]) {
      if (failConstruction) throw new Error("no websocket");
      created.push({ url, options });
    }
    public channel(topic: string, opts: { config: unknown }) {
      const record = { topic, config: opts.config, handlers: [] as Array<(payload: unknown) => void>, subscribed: false };
      channels.push(record);
      const channel = {
        on: (_type: string, _filter: unknown, handler: (payload: unknown) => void) => {
          record.handlers.push(handler);
          return channel;
        },
        subscribe: () => {
          record.subscribed = true;
          return channel;
        },
      };
      return channel;
    }
    public disconnect = disconnect;
  },
}));
vi.mock("../auth/supabase/supabaseEnv", () => ({
  getRequiredSupabaseClientEnv: () => ({ url: "https://example.supabase.co", anonKey: "anon", redirectUrl: "https://app/" }),
}));

import { SupabaseSyncSignal } from "./SupabaseSyncSignal";

describe("SupabaseSyncSignal", () => {
  beforeEach(() => {
    created.length = 0;
    channels.length = 0;
    disconnect.mockClear();
    failConstruction = false;
  });

  it("listens on the user's own private channel, with the user's token", async () => {
    const signal = new SupabaseSyncSignal({ getAccessToken: async () => "user-token" });
    signal.subscribe("user-1", () => undefined);

    expect(created[0].url).toBe("wss://example.supabase.co/realtime/v1");
    expect(created[0].options.params.apikey).toBe("anon");
    expect(await created[0].options.accessToken()).toBe("user-token");
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({ topic: "sync:user-1", config: { private: true }, subscribed: true });
  });

  it("calls back when the server says something changed", () => {
    const onChange = vi.fn();
    new SupabaseSyncSignal({ getAccessToken: async () => null }).subscribe("user-1", onChange);
    channels[0].handlers[0]({ event: "changed" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("disconnects when told to stop", () => {
    const stop = new SupabaseSyncSignal({ getAccessToken: async () => null }).subscribe("user-1", () => undefined);
    stop();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the connection cannot even be started", () => {
    failConstruction = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stop = new SupabaseSyncSignal({ getAccessToken: async () => null }).subscribe("user-1", () => undefined);
    expect(() => stop()).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
