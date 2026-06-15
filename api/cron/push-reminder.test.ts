import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMockRequest, createMockResponse } from "../_lib/testHelpers";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

vi.mock("../_lib/apiEnv.js", () => ({
  getRequiredVercelKvEnv: vi.fn(() => ({
    kvRestApiUrl: "https://kv.test",
    kvRestApiToken: "tok",
  })),
  getVapidKeys: vi.fn(),
  getCronSecret: vi.fn(),
}));

vi.mock("../_lib/pushKv.js", () => ({
  getAllSubscriberIds: vi.fn(),
  getPushSubscription: vi.fn(),
  deletePushSubscription: vi.fn(),
  checkAndMarkSent: vi.fn(),
}));

import handler from "./push-reminder";
import webPush from "web-push";
import { getVapidKeys, getCronSecret } from "../_lib/apiEnv.js";
import {
  getAllSubscriberIds,
  getPushSubscription,
  deletePushSubscription,
  checkAndMarkSent,
} from "../_lib/pushKv.js";

// web-push has no TS types; access mocked methods via cast
const wp = webPush as unknown as Record<string, ReturnType<typeof vi.fn>>;

const mockGetVapidKeys = vi.mocked(getVapidKeys);
const mockGetCronSecret = vi.mocked(getCronSecret);
const mockGetAllSubscriberIds = vi.mocked(getAllSubscriberIds);
const mockGetPushSubscription = vi.mocked(getPushSubscription);
const mockDeletePushSubscription = vi.mocked(deletePushSubscription);
const mockCheckAndMarkSent = vi.mocked(checkAndMarkSent);

const VAPID_KEYS = {
  publicKey: "test-pub-key",
  privateKey: "test-priv-key",
  subject: "mailto:test@example.com",
};

// reminderMinuteUtc: 600 = 10:00 UTC
const SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test",
  expirationTime: null,
  keys: { p256dh: "test-p256dh", auth: "test-auth" },
  reminderMinuteUtc: 600,
};

beforeEach(() => {
  vi.clearAllMocks();
  // 2026-01-01 10:00:00 UTC → utcHour=10, utcMinute=0, currentWindowMinute=600
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));

  mockGetCronSecret.mockReturnValue(null);
  mockGetVapidKeys.mockReturnValue(VAPID_KEYS);
  mockGetAllSubscriberIds.mockResolvedValue(["user-1"]);
  mockGetPushSubscription.mockResolvedValue(SUBSCRIPTION);
  mockCheckAndMarkSent.mockResolvedValue(true);
  wp["setVapidDetails"].mockReturnValue(undefined);
  wp["sendNotification"].mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/cron/push-reminder", () => {
  it("returns 405 for non-POST methods", async () => {
    const req = createMockRequest({ method: "GET" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(405);
  });

  it("returns 401 when cron secret header is wrong", async () => {
    mockGetCronSecret.mockReturnValue("correct-secret");
    const req = createMockRequest({
      method: "POST",
      headers: { authorization: "Bearer wrong-secret" },
    });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(401);
  });

  it("accepts correct cron secret", async () => {
    mockGetCronSecret.mockReturnValue("correct-secret");
    const req = createMockRequest({
      method: "POST",
      headers: { authorization: "Bearer correct-secret" },
    });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
  });

  it("skips with 200 when VAPID keys are not configured", async () => {
    mockGetVapidKeys.mockReturnValue(null);
    const req = createMockRequest({ method: "POST" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect((state.jsonPayload as { skipped: boolean }).skipped).toBe(true);
    expect(wp["sendNotification"]).not.toHaveBeenCalled();
  });

  it("sends notification when minute window matches (X:00 slot)", async () => {
    const req = createMockRequest({ method: "POST" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(wp["sendNotification"]).toHaveBeenCalledOnce();
    const result = state.jsonPayload as { sent: number; skipped: number; removed: number };
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.removed).toBe(0);
    expect(state.statusCode).toBe(200);
  });

  it("sends notification when minute window matches (X:30 slot)", async () => {
    vi.setSystemTime(new Date("2026-01-01T10:30:00.000Z"));
    mockGetPushSubscription.mockResolvedValue({ ...SUBSCRIPTION, reminderMinuteUtc: 630 });
    const req = createMockRequest({ method: "POST" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(wp["sendNotification"]).toHaveBeenCalledOnce();
    expect((state.jsonPayload as { sent: number }).sent).toBe(1);
  });

  it("skips notification when minute window does not match", async () => {
    mockGetPushSubscription.mockResolvedValue({ ...SUBSCRIPTION, reminderMinuteUtc: 630 });
    const req = createMockRequest({ method: "POST" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(wp["sendNotification"]).not.toHaveBeenCalled();
    expect((state.jsonPayload as { sent: number }).sent).toBe(0);
  });

  it("skips already-sent subscriptions and increments skipped count", async () => {
    mockCheckAndMarkSent.mockResolvedValue(false);
    const req = createMockRequest({ method: "POST" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(wp["sendNotification"]).not.toHaveBeenCalled();
    const result = state.jsonPayload as { sent: number; skipped: number };
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
  });

  it("removes subscription on 410 (expired) and increments removed count", async () => {
    wp["sendNotification"].mockRejectedValue(Object.assign(new Error("Gone"), { statusCode: 410 }));
    const req = createMockRequest({ method: "POST" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(mockDeletePushSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ kvRestApiUrl: "https://kv.test" }),
      "user-1"
    );
    const result = state.jsonPayload as { sent: number; removed: number };
    expect(result.removed).toBe(1);
    expect(result.sent).toBe(0);
    expect(state.statusCode).toBe(200);
  });

  it("removes subscription on 404 (unregistered)", async () => {
    wp["sendNotification"].mockRejectedValue(Object.assign(new Error("Not Found"), { statusCode: 404 }));
    const req = createMockRequest({ method: "POST" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(mockDeletePushSubscription).toHaveBeenCalledOnce();
    expect((state.jsonPayload as { removed: number }).removed).toBe(1);
  });

  it("ignores other send errors and leaves subscription intact", async () => {
    wp["sendNotification"].mockRejectedValue(Object.assign(new Error("Server Error"), { statusCode: 500 }));
    const req = createMockRequest({ method: "POST" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(mockDeletePushSubscription).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(200);
    const result = state.jsonPayload as { sent: number; removed: number };
    expect(result.sent).toBe(0);
    expect(result.removed).toBe(0);
  });

  it("skips gracefully when subscription record is missing", async () => {
    mockGetPushSubscription.mockResolvedValue(null);
    const req = createMockRequest({ method: "POST" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(wp["sendNotification"]).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(200);
  });
});
