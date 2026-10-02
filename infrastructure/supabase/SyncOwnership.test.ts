import { describe, expect, it, vi } from "vitest";
import { FakeGateway } from "./fakeGateway.testSupport";
import { day, newDevice } from "./syncDevice.testSupport";

/**
 * Local data is not stored per account. When this browser holds another account's data, no sync may read or write
 * anything, whichever way it was started, otherwise that data would be uploaded to whoever signed in next.
 */
const otherAccount = () => ({ check: vi.fn(async () => "otherAccount" as const) });
const sameAccount = () => ({ check: vi.fn(async () => "ok" as const) });

describe("a browser that holds another account's data", () => {
  for (const [name, run] of [
    ["the automatic sync", (d: ReturnType<typeof newDevice>) => d.sync()],
    ["the Sync now button", (d: ReturnType<typeof newDevice>) => d.syncByHand()],
  ] as const) {
    it(`is not synced by ${name}: nothing is read, uploaded or recorded`, async () => {
      const gateway = new FakeGateway();
      const device = newDevice(gateway, { ownership: otherAccount() });
      device.days.data = { "2026-10-01": day("2026-10-01", "the other account's workout") };

      const result = await run(device);

      expect(result.status).toBe("error");
      expect(result.reason).toBe("otherAccount");
      expect(gateway.rowsRead).toBe(0);
      expect(Object.values(gateway.upserted).every((n) => n === 0)).toBe(true);
      expect(gateway.tables.workout_days.size).toBe(0);
      expect(device.settings.settings.lastSyncedAt).toBeNull();
      expect(device.settings.settings.lastError).toBeNull();
      expect(Object.keys(device.days.data)).toEqual(["2026-10-01"]); // and the device keeps what it had
    });
  }

  it("syncs normally when the data belongs to the signed-in account", async () => {
    const gateway = new FakeGateway();
    const ownership = sameAccount();
    const device = newDevice(gateway, { ownership });
    device.days.data = { "2026-10-01": day("2026-10-01", "mine") };

    expect((await device.syncByHand()).status).toBe("success");
    expect(ownership.check).toHaveBeenCalled();
    expect([...gateway.tables.workout_days.keys()]).toEqual(["2026-10-01"]);
  });
});
