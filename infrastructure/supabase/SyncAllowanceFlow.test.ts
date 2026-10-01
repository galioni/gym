import { describe, expect, it, vi } from "vitest";
import { SyncAllowanceError } from "../../application/sync/syncAllowance";
import { historyCutoff } from "../../application/sync/historyWindow";
import { Templates } from "../../types";
import { FakeGateway } from "./fakeGateway.testSupport";
import { day, newDevice, tpl } from "./syncDevice.testSupport";

/**
 * The Free plan's monthly sync, as the real sync service sees it. The allowance is asked at the start of every sync; a
 * refusal there means nothing is read or written (a sync is both directions), and a refusal in the middle (the window
 * closed while uploading) is handled like a storage limit: what arrived is kept and the rest waits.
 */

const NEXT = "2026-11-01T10:00:00.000Z";
const allowed = () => ({ begin: vi.fn(async () => ({ historyDays: null })) });
const used = () => ({
  begin: vi.fn(async () => {
    throw new SyncAllowanceError(NEXT);
  }),
});
const some = (n: number): Templates => Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i + 1}`, tpl(`move ${i + 1}`)]));
const cloudKeys = (gateway: FakeGateway) => [...gateway.tables.templates.keys()].sort();

describe("asking for permission before a sync", () => {
  it("asks at the start of every sync, and lets an allowed sync go ahead", async () => {
    const gateway = new FakeGateway();
    const allowance = allowed();
    const device = newDevice(gateway, { allowance });
    device.templates.set(some(2));

    const first = await device.sync();
    const second = await device.sync();

    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    expect(allowance.begin).toHaveBeenCalledTimes(2);
    expect(cloudKeys(gateway)).toEqual(["t1", "t2"]);
  });

  it("refused: nothing is read, written or recorded, and the next date is reported", async () => {
    const gateway = new FakeGateway();
    const reads = vi.spyOn(gateway, "selectAll");
    const device = newDevice(gateway, { allowance: used() });
    device.templates.set(some(3));

    const result = await device.sync();

    expect(result.status).toBe("error");
    expect(result.reason).toBe("allowance");
    expect(result.nextAvailableAt).toBe(NEXT);
    expect(reads).not.toHaveBeenCalled();
    expect(cloudKeys(gateway)).toEqual([]);
    expect(Object.keys(device.templates.data)).toHaveLength(3);
    expect(device.settings.base).toEqual({ days: {}, templates: {}, plans: {}, settings: {} });
  });

  it("refused: this is not a failure, so no error is recorded against the account", async () => {
    const device = newDevice(new FakeGateway(), { allowance: used() });
    device.templates.set(some(1));

    await device.sync();

    expect(device.settings.settings.lastError).toBeNull();
    expect(device.settings.settings.lastSyncedAt).toBeNull();
  });

  it("refused: the next sync that is allowed picks everything up", async () => {
    const gateway = new FakeGateway();
    let open = false;
    const device = newDevice(gateway, {
      allowance: {
        begin: async () => {
          if (!open) throw new SyncAllowanceError(NEXT);
          return { historyDays: null };
        },
      },
    });
    device.templates.set(some(3));
    await device.sync();
    expect(cloudKeys(gateway)).toEqual([]);

    open = true;
    const result = await device.sync();

    expect(result.status).toBe("success");
    expect(cloudKeys(gateway)).toEqual(["t1", "t2", "t3"]);
  });

  it("an account with no allowance (Pro, or the switch off) is unaffected", async () => {
    const gateway = new FakeGateway();
    const device = newDevice(gateway);
    device.templates.set(some(2));
    expect((await device.sync()).status).toBe("success");
  });

  it("any other failure to ask is a real error that is retried, not a silent pass", async () => {
    const gateway = new FakeGateway();
    const device = newDevice(gateway, {
      allowance: {
        begin: async () => {
          throw new Error("Could not start the sync: connection failure");
        },
      },
    });
    device.templates.set(some(1));

    const result = await device.sync();

    expect(result.status).toBe("error");
    expect(result.reason).toBeUndefined();
    expect(result.message).toContain("connection failure");
    expect(cloudKeys(gateway)).toEqual([]);
  });
});

describe("the window closing in the middle of a sync", () => {
  it("keeps what arrived, reports the next date, and records no error", async () => {
    const gateway = new FakeGateway();
    // Another device already put two templates in the cloud.
    const other = newDevice(gateway);
    other.templates.set(some(2));
    await other.sync();

    // This device has its own new template, and the database refuses its upload.
    const device = newDevice(gateway, { allowance: allowed() });
    device.templates.set({ mine: tpl("only on this device") });
    gateway.refuseWrites = new SyncAllowanceError(NEXT);

    const result = await device.sync();

    expect(result.reason).toBe("allowance");
    expect(result.nextAvailableAt).toBe(NEXT);
    expect(device.settings.settings.lastError).toBeNull();
    // Downloads still landed, and nothing local was lost.
    expect(Object.keys(device.templates.data).sort()).toEqual(["mine", "t1", "t2"]);
    // The part that is agreed is recorded, so the next sync is not confused.
    expect(Object.keys(device.settings.base.templates).sort()).toEqual(["t1", "t2"]);
    expect(cloudKeys(gateway)).toEqual(["t1", "t2"]);
  });

  it("the sync after the window reopens uploads what waited", async () => {
    const gateway = new FakeGateway();
    const device = newDevice(gateway, { allowance: allowed() });
    device.templates.set(some(2));
    gateway.refuseWrites = new SyncAllowanceError(NEXT);
    await device.sync();
    expect(cloudKeys(gateway)).toEqual([]);

    gateway.refuseWrites = null;
    const result = await device.sync();

    expect(result.status).toBe("success");
    expect(cloudKeys(gateway)).toEqual(["t1", "t2"]);
  });
});

describe("the automatic sync of a Free account only downloads", () => {
  const writesTo = (gateway: FakeGateway) => ({
    upsert: vi.spyOn(gateway, "upsertRows"),
    markDeleted: vi.spyOn(gateway, "markDaysDeleted"),
    deleteMissing: vi.spyOn(gateway, "deleteMissing"),
  });

  it("restores the cloud's data onto a new device and sends nothing, so the month is not spent", async () => {
    const gateway = new FakeGateway();
    const phone = newDevice(gateway);
    phone.templates.set(some(2));
    await phone.sync(); // the account already has data in the cloud

    const allowance = allowed();
    const newPhone = newDevice(gateway, { allowance });
    newPhone.templates.set({ blank: tpl("a blank default on the new device") });
    const writes = writesTo(gateway);

    const result = await newPhone.syncDownloadOnly();

    expect(result.status).toBe("success");
    expect(allowance.begin).toHaveBeenCalledTimes(1); // reads are still gated by the allowance check
    expect(Object.keys(newPhone.templates.data).sort()).toEqual(["blank", "t1", "t2"]);
    expect(writes.upsert).not.toHaveBeenCalled();
    expect(writes.markDeleted).not.toHaveBeenCalled();
    expect(writes.deleteMissing).not.toHaveBeenCalled();
    expect(cloudKeys(gateway)).toEqual(["t1", "t2"]);
  });

  it("counts as the device's first sync, and records only what both sides agree on", async () => {
    const gateway = new FakeGateway();
    const phone = newDevice(gateway);
    phone.templates.set(some(2));
    await phone.sync();

    const newPhone = newDevice(gateway);
    newPhone.templates.set({ blank: tpl("a blank default") });
    await newPhone.syncDownloadOnly();

    expect(newPhone.settings.settings.lastSyncedAt).not.toBeNull();
    expect(Object.keys(newPhone.settings.base.templates).sort()).toEqual(["t1", "t2"]);
  });

  it("a brand-new account has nothing to restore and still sends nothing", async () => {
    const gateway = new FakeGateway();
    const device = newDevice(gateway);
    device.templates.set(some(3));
    device.days.data = { "2026-10-01": day("2026-10-01", "today, blank") };
    const writes = writesTo(gateway);

    const result = await device.syncDownloadOnly();

    expect(result.status).toBe("success");
    expect(writes.upsert).not.toHaveBeenCalled();
    expect(cloudKeys(gateway)).toEqual([]);
    expect(Object.keys(device.templates.data)).toHaveLength(3);
    expect(Object.keys(device.days.data)).toEqual(["2026-10-01"]);
  });

  it("does not forget a day deleted on this device: the deletion waits for the next upload", async () => {
    const gateway = new FakeGateway();
    const device = newDevice(gateway);
    device.days.data = { "2026-10-01": day("2026-10-01", "to be deleted"), "2026-10-02": day("2026-10-02", "kept") };
    await device.sync();

    device.days.userDeletes("2026-10-01");
    const writes = writesTo(gateway);
    await device.syncDownloadOnly();

    expect(writes.markDeleted).not.toHaveBeenCalled();
    expect(Object.keys(device.days.tombstones)).toEqual(["2026-10-01"]);

    await device.sync(); // the deliberate sync
    const live = [...gateway.tables.workout_days.values()].filter((row) => row.deleted_at == null).map((row) => String(row.day));
    expect(live).toEqual(["2026-10-02"]);
    expect(Object.keys(device.days.tombstones)).toEqual([]);
  });

  it("applies deletions made elsewhere, since that is a download", async () => {
    const gateway = new FakeGateway();
    const laptop = newDevice(gateway);
    laptop.days.data = { "2026-10-01": day("2026-10-01", "a"), "2026-10-02": day("2026-10-02", "b") };
    await laptop.sync();
    const phone = newDevice(gateway);
    await phone.sync(); // the phone has both days, in agreement

    laptop.days.userDeletes("2026-10-01");
    await laptop.sync();
    await phone.syncDownloadOnly();

    expect(Object.keys(phone.days.data)).toEqual(["2026-10-02"]);
  });

  it("the next deliberate sync uploads everything that waited", async () => {
    const gateway = new FakeGateway();
    const device = newDevice(gateway);
    device.templates.set(some(3));
    await device.syncDownloadOnly();
    expect(cloudKeys(gateway)).toEqual([]);

    const result = await device.sync();

    expect(result.status).toBe("success");
    expect(cloudKeys(gateway)).toEqual(["t1", "t2", "t3"]);
  });
});

describe("the Free plan's 7-day history in the cloud", () => {
  const ago = (n: number) => historyCutoff(n + 1); // the date n days before today
  const free = () => ({ begin: vi.fn(async () => ({ historyDays: 7 })) });
  const cloudDays = (gateway: FakeGateway) => [...gateway.tables.workout_days.keys()].sort();

  it("uploads only the last 7 days, and the device keeps every day", async () => {
    const gateway = new FakeGateway();
    const device = newDevice(gateway, { allowance: free() });
    device.days.data = { [ago(0)]: day(ago(0), "today"), [ago(6)]: day(ago(6), "edge"), [ago(7)]: day(ago(7), "old"), [ago(40)]: day(ago(40), "older") };

    const result = await device.sync();

    expect(result.status).toBe("success");
    expect(cloudDays(gateway)).toEqual([ago(6), ago(0)].sort());
    expect(Object.keys(device.days.data).sort()).toEqual([ago(40), ago(7), ago(6), ago(0)].sort());
  });

  it("still downloads older days that are already in the cloud (an account that used to be Pro)", async () => {
    const gateway = new FakeGateway();
    const pro = newDevice(gateway);
    pro.days.data = { [ago(40)]: day(ago(40), "from Pro days") };
    await pro.sync();

    const phone = newDevice(gateway, { allowance: free() });
    await phone.sync();

    expect(Object.keys(phone.days.data)).toEqual([ago(40)]);
    expect(cloudDays(gateway)).toEqual([ago(40)]); // nothing was removed from the cloud either
  });

  it("does not send a deletion of an old day", async () => {
    const gateway = new FakeGateway();
    const pro = newDevice(gateway);
    pro.days.data = { [ago(40)]: day(ago(40), "x") };
    await pro.sync();
    const phone = newDevice(gateway, { allowance: free() });
    await phone.sync();

    phone.days.userDeletes(ago(40));
    await phone.sync();

    expect(cloudDays(gateway)).toEqual([ago(40)]);
  });
});
