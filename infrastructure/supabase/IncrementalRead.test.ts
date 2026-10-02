import { describe, expect, it } from "vitest";
import { FULL_READ_EVERY_MS, INCREMENTAL_OVERLAP_MS, PostgresWorkoutDataRepository } from "./PostgresRepositories";
import { FakeGateway } from "./fakeGateway.testSupport";
import { day } from "./syncDevice.testSupport";
import { dayToRow } from "./postgresRows";

/**
 * Workout days are read incrementally: the first read of a session takes every row, later reads take only rows changed since
 * the newest server timestamp already held (minus a small overlap), and everything is re-read now and then because the server
 * also removes rows. These tests pin down that the result is always what a full read would have returned.
 */

const date = (n: number) => `2026-09-${String(n).padStart(2, "0")}`;

/** Row i was last changed i * 10 minutes after 10:00, so only the newest rows fall inside the overlap. */
const stamp = (i: number) => new Date(Date.parse("2026-09-01T10:00:00.000Z") + i * 10 * 60_000).toISOString();

function seed(gateway: FakeGateway, count: number) {
  for (let i = 1; i <= count; i++) {
    gateway.tables.workout_days.set(date(i), { ...dayToRow("user-1", date(i), day(date(i), `note ${i}`)), updated_at: stamp(i) });
  }
}

function setup(count = 20) {
  const gateway = new FakeGateway();
  seed(gateway, count);
  let now = 1_000_000;
  const repo = new PostgresWorkoutDataRepository(gateway, () => now);
  return { gateway, repo, advance: (ms: number) => (now += ms) };
}

/** What a brand-new repository (always a full read) sees: the reference answer. */
const fullRead = async (gateway: FakeGateway) => new PostgresWorkoutDataRepository(gateway).readSnapshot();

describe("incremental reads of workout days", () => {
  it("reads every row the first time, then only what changed", async () => {
    const { gateway, repo } = setup(20);
    await repo.readSnapshot();
    expect(gateway.readCalls).toEqual({ full: 1, changed: 0 });
    expect(gateway.rowsRead).toBe(20);

    gateway.rowsRead = 0;
    const second = await repo.readSnapshot();
    expect(gateway.readCalls).toEqual({ full: 1, changed: 1 });
    expect(gateway.rowsRead).toBeLessThanOrEqual(1); // only the newest row, kept by the overlap
    expect(Object.keys(second!.data)).toHaveLength(20);
  });

  it("returns exactly what a full read returns after other devices edit, delete and restore days", async () => {
    const { gateway, repo } = setup(10);
    await repo.readSnapshot();

    const other = new PostgresWorkoutDataRepository(gateway);
    await other.readSnapshot();
    await other.writeSnapshot({ version: 1, updatedAt: "", data: { ...(await other.readAll()), [date(2)]: day(date(2), "edited elsewhere"), [date(11)]: day(date(11), "added elsewhere") } });
    await other.writeSnapshot({ version: 1, updatedAt: "", data: await other.readAll(), deletedDays: { [date(3)]: "hash-3" } });

    const incremental = await repo.readSnapshot();
    const reference = await fullRead(gateway);
    expect(incremental).toEqual(reference);
    expect(incremental!.data[date(2)].mainNotes).toBe("edited elsewhere");
    expect(incremental!.data[date(11)]).toBeDefined();
    expect(incremental!.deletedDays).toEqual({ [date(3)]: "hash-3" });
    expect(incremental!.data[date(3)]).toBeUndefined();

    // A day deleted and then written again comes back live.
    await other.writeSnapshot({ version: 1, updatedAt: "", data: { ...(await other.readAll()), [date(3)]: day(date(3), "back again") } });
    expect(await repo.readSnapshot()).toEqual(await fullRead(gateway));
    expect((await repo.readSnapshot())!.data[date(3)].mainNotes).toBe("back again");
  });

  it("still sees a row that was stamped a little before the cursor (a transaction that committed late)", async () => {
    const { gateway, repo } = setup(5);
    await repo.readSnapshot(); // the cursor is stamp(5)
    gateway.tables.workout_days.set(date(20), { ...dayToRow("user-1", date(20), day(date(20), "late commit")), updated_at: new Date(Date.parse(stamp(5)) - 30_000).toISOString() });

    const snapshot = await repo.readSnapshot();
    expect(snapshot!.data[date(20)]?.mainNotes).toBe("late commit");
  });

  it("does not see a row stamped before the overlap until the next full read", async () => {
    const { gateway, repo, advance } = setup(5);
    await repo.readSnapshot();
    gateway.tables.workout_days.set(date(20), { ...dayToRow("user-1", date(20), day(date(20), "very late")), updated_at: new Date(Date.parse(stamp(5)) - INCREMENTAL_OVERLAP_MS - 1000).toISOString() });
    expect((await repo.readSnapshot())!.data[date(20)]).toBeUndefined();

    advance(FULL_READ_EVERY_MS);
    expect((await repo.readSnapshot())!.data[date(20)]?.mainNotes).toBe("very late");
  });

  it("notices rows the server purged once the hourly full read comes round", async () => {
    const { gateway, repo, advance } = setup(5);
    await repo.readSnapshot();
    gateway.tables.workout_days.delete(date(1)); // a purge: no timestamp changes, the row is just gone

    expect(Object.keys((await repo.readSnapshot())!.data)).toHaveLength(5); // an incremental read cannot know
    advance(FULL_READ_EVERY_MS - 1);
    expect(Object.keys((await repo.readSnapshot())!.data)).toHaveLength(5);
    advance(1);
    expect(Object.keys((await repo.readSnapshot())!.data)).toHaveLength(4);
    expect(gateway.readCalls.full).toBe(2);
  });

  it("starts over with a full read when a different user signs in", async () => {
    const { gateway, repo } = setup(5);
    await repo.readSnapshot();
    const full = gateway.readCalls.full;
    gateway.requireUserId = async () => "user-2";
    await repo.readSnapshot();
    expect(gateway.readCalls.full).toBe(full + 1);
  });

  it("an empty account reads as nothing, every time, and a first write is then seen", async () => {
    const { gateway, repo } = setup(0);
    expect(await repo.readSnapshot()).toBeNull();
    expect(await repo.readSnapshot()).toBeNull();
    await repo.writeSnapshot({ version: 1, updatedAt: "", data: { [date(1)]: day(date(1), "first") } });
    expect((await repo.readSnapshot())!.data[date(1)].mainNotes).toBe("first");
    expect(gateway.tables.workout_days.size).toBe(1);
  });

  it("a failed incremental read changes nothing and the next one succeeds", async () => {
    const { gateway, repo } = setup(5);
    await repo.readSnapshot();
    const before = await repo.readSnapshot();
    const real = gateway.selectChangedSince.bind(gateway);
    gateway.selectChangedSince = async () => {
      throw new Error("network down");
    };
    await expect(repo.readSnapshot()).rejects.toThrow("network down");
    gateway.selectChangedSince = real;
    expect(await repo.readSnapshot()).toEqual(before);
  });

  it("writes after an incremental read still send only the days that changed", async () => {
    const { gateway, repo } = setup(10);
    await repo.readSnapshot();
    const snapshot = (await repo.readSnapshot())!;
    gateway.upserted.workout_days = 0;
    await repo.writeSnapshot({ ...snapshot, data: { ...snapshot.data, [date(4)]: day(date(4), "changed here") } });
    expect(gateway.upserted.workout_days).toBe(1);
  });
});
