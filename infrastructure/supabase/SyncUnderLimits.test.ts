import { describe, expect, it } from "vitest";
import { Templates } from "../../types";
import { FakeGateway } from "./fakeGateway.testSupport";
import { day, newDevice, tpl } from "./syncDevice.testSupport";

/**
 * The real sync service and the real Postgres repositories, against a database that refuses rows beyond a cap like the
 * row-limit trigger does. This is what a Free account lives with: 5 templates, 1,000 days.
 */

const cloudTemplateKeys = (gateway: FakeGateway) => [...gateway.tables.templates.keys()].sort();
const cloudLiveDays = (gateway: FakeGateway) =>
  [...gateway.tables.workout_days.values()].filter((row) => row.deleted_at == null).map((row) => String(row.day)).sort();

describe("a Free account at its template limit", () => {
  const seven = (): Templates => Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`t${n}`, tpl(`move ${n}`)]));

  it("stores what fits, keeps everything on the device, and reports the limit", async () => {
    const gateway = new FakeGateway();
    gateway.caps.templates = 5;
    const device = newDevice(gateway);
    device.templates.set(seven());

    const result = await device.sync();

    expect(result.status).toBe("error");
    expect(result.reason).toBe("storageLimit");
    expect(cloudTemplateKeys(gateway)).toEqual(["t1", "t2", "t3", "t4", "t5"]);
    expect(Object.keys(device.templates.data)).toHaveLength(7);
  });

  it("records what was accepted, so a later edit is an edit and not a clash with an unknown ancestor", async () => {
    const gateway = new FakeGateway();
    gateway.caps.templates = 5;
    const device = newDevice(gateway);
    device.templates.set(seven());
    await device.sync();
    expect(Object.keys(device.settings.base.templates).sort()).toEqual(["t1", "t2", "t3", "t4", "t5"]);

    device.templates.set({ ...device.templates.data, t1: tpl("move 1 EDITED") });
    const result = await device.sync();

    expect(result.status).toBe("error");
    expect(result.reason).toBe("storageLimit"); // t6 and t7 are still over the limit, but no conflict was raised
    expect(JSON.stringify(gateway.tables.templates.get("t1"))).toContain("move 1 EDITED");
  });

  it("uses room freed by a deletion in the same sync", async () => {
    const gateway = new FakeGateway();
    gateway.caps.templates = 5;
    const device = newDevice(gateway);
    device.templates.set(seven());
    await device.sync();

    const { t5, ...withoutT5 } = device.templates.data;
    void t5;
    device.templates.set(withoutT5);
    await device.sync();

    expect(cloudTemplateKeys(gateway)).toEqual(["t1", "t2", "t3", "t4", "t6"]);
  });

  it("finishes the job once the account is upgraded", async () => {
    const gateway = new FakeGateway();
    gateway.caps.templates = 5;
    const device = newDevice(gateway);
    device.templates.set(seven());
    await device.sync();

    gateway.caps.templates = 200; // upgraded to Pro
    const result = await device.sync();

    expect(result.status).toBe("success");
    expect(cloudTemplateKeys(gateway)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
  });

  it("does not undo a removal made on another device while it is blocked from adding", async () => {
    const gateway = new FakeGateway();
    gateway.caps.templates = 5;
    const phone = newDevice(gateway);
    phone.templates.set(seven());
    await phone.sync(); // t1..t5 in the cloud and in the phone's base

    // The laptop (which synced t1..t5 earlier) deletes t2 from the cloud.
    gateway.tables.templates.delete("t2");

    const result = await phone.sync(); // phone still has t2, t6, t7 over a cap of 5 minus the removal

    expect(["error", "success"]).toContain(result.status);
    expect(cloudTemplateKeys(gateway)).not.toContain("t2");
    expect(Object.keys(phone.templates.data)).not.toContain("t2");
  });
});

describe("a Free account at its day limit", () => {
  it("can delete a day and add another in the same sync", async () => {
    const gateway = new FakeGateway();
    const device = newDevice(gateway);
    device.days.data = { "2026-10-01": day("2026-10-01", "a"), "2026-10-02": day("2026-10-02", "b") };
    await device.sync();
    expect(cloudLiveDays(gateway)).toEqual(["2026-10-01", "2026-10-02"]);

    gateway.caps.workout_days = 2;
    device.days.userDeletes("2026-10-01");
    device.days.data["2026-10-03"] = day("2026-10-03", "c");
    const result = await device.sync();

    expect(result.status === "success" ? "success" : result.message).toBe("success");
    expect(cloudLiveDays(gateway)).toEqual(["2026-10-02", "2026-10-03"]);
  });

  it("keeps syncing edits to existing days when a new day does not fit", async () => {
    const gateway = new FakeGateway();
    const device = newDevice(gateway);
    device.days.data = { "2026-10-01": day("2026-10-01", "a") };
    await device.sync();

    gateway.caps.workout_days = 1;
    device.days.data = { "2026-10-01": day("2026-10-01", "a EDITED"), "2026-10-02": day("2026-10-02", "new") };
    const result = await device.sync();

    expect(result.reason).toBe("storageLimit");
    expect(String(gateway.tables.workout_days.get("2026-10-01")?.main_notes)).toBe("a EDITED");
    expect(cloudLiveDays(gateway)).toEqual(["2026-10-01"]);
    expect(Object.keys(device.days.data)).toHaveLength(2); // the refused day is still on the device
  });
});
