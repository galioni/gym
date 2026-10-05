import { describe, expect, it } from "vitest";
import { UserTable } from "../../infrastructure/supabase/PostgrestRowGateway";
import { FakeGateway } from "../../infrastructure/supabase/fakeGateway.testSupport";
import { day, newDevice } from "../../infrastructure/supabase/syncDevice.testSupport";

/**
 * Regression test for a defect found while building the Flutter client (fixed 2026-10-03; mobile/test/sync/sync_engine_test.dart
 * has the same scenario for the Dart side).
 */

class HookGateway extends FakeGateway {
  public hook: (() => void) | null = null;
  public override async selectAll<T>(table: UserTable): Promise<T[]> {
    if (table === "workout_days") this.hook?.();
    return super.selectAll<T>(table);
  }
}

describe("an edit made while a sync is running", () => {
  /**
   * The user edits while a sync runs, so SyncService skips its local write (the edit is newer than the merge). It used to
   * record the whole merge as agreed anyway (`baseDaysFrom`), so the next sync read this device's stale copy of a day
   * another device had changed as a fresh local edit and uploaded it over the other device's change: silent loss of that
   * edit. The base now holds only what this device verifiably has (`agreedDaysBase`).
   */
  it("an edit typed during a sync does not make the next sync overwrite another device's change", async () => {
    const gateway = new HookGateway();
    const a = newDevice(gateway);
    const b = newDevice(gateway);
    a.days.data["2026-10-01"] = day("2026-10-01", "v1");
    await a.sync();
    await b.sync();
    b.days.data["2026-10-01"] = day("2026-10-01", "v2 from b");
    await b.sync();

    gateway.hook = () => {
      a.days.data["2026-10-02"] = day("2026-10-02", "typed during sync");
      gateway.hook = null;
    };
    await a.sync();
    await a.sync();

    const cloud = gateway.tables.workout_days.get("2026-10-01") as { main_notes: string };
    expect(cloud.main_notes).toBe("v2 from b");
    expect(a.days.data["2026-10-01"].mainNotes).toBe("v2 from b");
  });
});
