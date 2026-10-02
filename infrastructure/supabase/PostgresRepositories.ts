import { DayData, GeneratedPlanMeta, Plan, PlanParams, Templates } from "../../types";
import { TEMPLATES, STORAGE_SCHEMA_VERSION, TEMPLATE_SCHEMA_VERSION, PLANS_SCHEMA_VERSION } from "../../constants";
import { PlansSnapshot, SettingsSnapshot, TemplateSnapshot, WorkoutDataSnapshot } from "../../application/sync/syncTypes";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { TemplateRepository } from "../../interfaces/workout/TemplateRepository";
import { PlansRepository } from "../../interfaces/workout/PlansRepository";
import { AccountSettingsRepository } from "../../interfaces/workout/AccountSettingsRepository";
import { sanitizeDayData, sanitizeDayDataRecord } from "../../application/workout/data/dayDataRules";
import { sanitizeTemplates } from "../../application/workout/templates/templateRules";
import { dayContentHash, hashString, stableSerialize } from "../../application/sync/contentHash";
import { CloudLimitError } from "../../application/sync/syncErrors";
import { RowGateway } from "./PostgrestRowGateway";
import {
  PlanRow,
  TemplateRow,
  WorkoutDayRow,
  dayToRow,
  latestUpdatedAt,
  plansToRows,
  rowsToPlans,
  rowsToRawTemplates,
  rowToRawDay,
  templatesToRows,
} from "./postgresRows";

/**
 * Incremental reads of workout days. A signed-in device keeps the rows it has read and, on later syncs, asks only for rows
 * changed since the newest server timestamp it holds, so a sync on a 5,000-day account no longer downloads 5,000 rows.
 *
 *   - OVERLAP: updated_at is the time a write's transaction STARTED. A transaction that started a moment before the cursor can
 *     commit after we read, so each request goes back this far and re-reads a few rows rather than miss one.
 *   - FULL_READ_EVERY: the server also removes rows (the daily purges of old deleted days and of Free-plan history). An
 *     incremental read cannot see a removal, so everything is re-read this often, and whenever the signed-in user changes.
 * The copy lives in memory only: opening the app always starts with one full read.
 */
export const INCREMENTAL_OVERLAP_MS = 2 * 60_000;
export const FULL_READ_EVERY_MS = 60 * 60_000;

const fingerprint = (value: unknown): string => hashString(stableSerialize(value));

/**
 * Writes the changed rows of a collection in an order that an account limit can never deadlock:
 *
 *   1. edits to rows the cloud already holds. An update adds no row, so it cannot hit a limit; before this order, one new
 *      item over the limit made the whole batch fail and kept every edit to existing items from syncing too;
 *   2. deletions, which free room. Without this, someone at the limit who deletes one item and adds another could never
 *      sync, because the new item was inserted before the old one was removed;
 *   3. new rows, as one batch. If that batch is refused for being over the limit, they are tried one by one in order until
 *      the first refusal, so an account with room for three more stores three instead of none.
 *
 * If any new row was refused, the limit error is thrown only AFTER the edits, deletions and the rows that fit are saved,
 * so the person is told while nothing else is held back.
 */
async function writeRespectingLimits<R extends object>(plan: {
  rows: R[];
  exists: (row: R) => boolean;
  upsert: (rows: R[]) => Promise<void>;
  deleteRemoved: () => Promise<void>;
  onWritten: (row: R) => void;
}): Promise<void> {
  const edits = plan.rows.filter(plan.exists);
  const additions = plan.rows.filter((row) => !plan.exists(row));

  if (edits.length > 0) {
    await plan.upsert(edits);
    edits.forEach(plan.onWritten);
  }
  await plan.deleteRemoved();
  if (additions.length === 0) return;

  try {
    await plan.upsert(additions);
    additions.forEach(plan.onWritten);
    return;
  } catch (error) {
    if (!(error instanceof CloudLimitError) || additions.length === 1) throw error;
    let refusal: CloudLimitError = error;
    for (const row of additions) {
      try {
        await plan.upsert([row]);
        plan.onWritten(row);
      } catch (single) {
        if (!(single instanceof CloudLimitError)) throw single;
        refusal = single;
        break;
      }
    }
    throw refusal;
  }
}

/**
 * Workout days in Postgres (one row per day). Writes upsert only the days that differ from what the last
 * read returned, so a sync touches the rows that changed and the server-owned updated_at stays meaningful.
 * Deletions arrive as snapshot.deletedDays and become soft deletes (see deletionReconciliation).
 */
export class PostgresWorkoutDataRepository implements WorkoutDataRepository {
  private lastRead = new Map<string, string>();
  private copy = new Map<string, WorkoutDayRow>();
  private copyOwner: string | null = null;
  private cursor: string | null = null;
  private fullReadAt = 0;

  public constructor(
    private readonly gateway: RowGateway,
    private readonly now: () => number = Date.now
  ) {}

  /** Every row of the account, from the kept copy brought up to date (or from a full read when that is due). */
  private async loadRows(): Promise<WorkoutDayRow[]> {
    const userId = await this.gateway.requireUserId();
    const due = this.copyOwner !== userId || this.cursor === null || this.now() - this.fullReadAt >= FULL_READ_EVERY_MS;
    if (due) {
      const rows = await this.gateway.selectAll<WorkoutDayRow>("workout_days");
      this.copy = new Map(rows.map((row) => [row.day, row]));
      this.copyOwner = userId;
      this.fullReadAt = this.now();
    } else {
      const since = new Date(Date.parse(this.cursor as string) - INCREMENTAL_OVERLAP_MS).toISOString();
      const changed = await this.gateway.selectChangedSince<WorkoutDayRow>("workout_days", since);
      for (const row of changed) this.copy.set(row.day, row);
    }
    const stamps = [...this.copy.values()].map((row) => row.updated_at).filter((value): value is string => typeof value === "string");
    // From the server's own stamps, never this device's clock. Without any stamp there is no cursor, so the next read is full.
    this.cursor = stamps.length > 0 ? stamps.reduce((a, b) => (a > b ? a : b)) : null;
    return [...this.copy.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }

  public async readSnapshot(): Promise<WorkoutDataSnapshot | null> {
    const rows = await this.loadRows();
    if (rows.length === 0) {
      this.lastRead = new Map();
      return null;
    }
    const live = rows.filter((row) => row.deleted_at === null);
    const deleted = rows.filter((row) => row.deleted_at !== null);

    const data = sanitizeDayDataRecord(
      Object.fromEntries(live.map((row) => [row.day, rowToRawDay(row)])),
      TEMPLATES
    );
    this.lastRead = new Map(Object.entries(data).map(([date, day]) => [date, dayContentHash(day)]));

    return {
      version: STORAGE_SCHEMA_VERSION,
      updatedAt: latestUpdatedAt(rows),
      data,
      // The database blanks a deleted day's content, so the hash it had at deletion is stored on the row. Rows
      // without one (written before that existed) still carry their content and are hashed as before.
      deletedDays: Object.fromEntries(
        deleted.map((row) => [
          row.day,
          row.deleted_hash ?? dayContentHash(sanitizeDayData(rowToRawDay(row), row.day, TEMPLATES)),
        ])
      ),
    };
  }

  public async writeSnapshot(snapshot: WorkoutDataSnapshot): Promise<void> {
    const userId = await this.gateway.requireUserId();
    const changed: WorkoutDayRow[] = [];
    for (const [date, day] of Object.entries(snapshot.data)) {
      if (this.lastRead.get(date) === dayContentHash(day)) continue;
      const row = dayToRow(userId, date, day);
      if (row) changed.push(row);
    }
    const toDelete = snapshot.deletedDays ?? {};
    await writeRespectingLimits({
      rows: changed,
      exists: (row) => this.lastRead.has(row.day),
      upsert: (rows) => this.gateway.upsertRows("workout_days", rows),
      deleteRemoved: async () => {
        if (Object.keys(toDelete).length === 0) return;
        await this.gateway.markDaysDeleted(toDelete);
        for (const date of Object.keys(toDelete)) this.lastRead.delete(date);
      },
      onWritten: (row) => this.lastRead.set(row.day, dayContentHash(snapshot.data[row.day])),
    });
  }

  public async readAll(): Promise<Record<string, DayData>> {
    return (await this.readSnapshot())?.data ?? {};
  }

  public async writeAll(data: Record<string, DayData>): Promise<void> {
    await this.writeSnapshot({ version: STORAGE_SCHEMA_VERSION, updatedAt: new Date().toISOString(), data });
  }
}

/**
 * Templates in Postgres (one row per session type). A snapshot write replaces the collection: changed
 * sessions are upserted and sessions absent from the snapshot are removed.
 */
export class PostgresTemplateRepository implements TemplateRepository {
  private lastRead = new Map<string, string>();

  public constructor(private readonly gateway: RowGateway) {}

  public async readSnapshot(): Promise<TemplateSnapshot | null> {
    const rows = await this.gateway.selectAll<TemplateRow>("templates");
    if (rows.length === 0) {
      this.lastRead = new Map();
      return null;
    }
    const data = sanitizeTemplates(rowsToRawTemplates(rows.filter((row) => row.deleted_at == null)));
    this.lastRead = new Map(Object.entries(data).map(([key, template]) => [key, fingerprint(template)]));
    return { version: TEMPLATE_SCHEMA_VERSION, updatedAt: latestUpdatedAt(rows), data };
  }

  public async writeSnapshot(snapshot: TemplateSnapshot): Promise<void> {
    const userId = await this.gateway.requireUserId();
    const rows = templatesToRows(userId, snapshot.data);
    const changed = rows.filter((row) => this.lastRead.get(row.session_type) !== fingerprint(snapshot.data[row.session_type]));
    await writeRespectingLimits({
      rows: changed,
      exists: (row) => this.lastRead.has(row.session_type),
      upsert: (batch) => this.gateway.upsertRows("templates", batch),
      deleteRemoved: () => this.gateway.deleteMissing("templates", rows.map((row) => row.session_type)),
      onWritten: (row) => this.lastRead.set(row.session_type, fingerprint(snapshot.data[row.session_type])),
    });
    this.lastRead = new Map(rows.map((row) => [row.session_type, fingerprint(snapshot.data[row.session_type])]));
  }

  public async readTemplates(): Promise<Templates | null> {
    return (await this.readSnapshot())?.data ?? null;
  }

  public async writeTemplates(templates: Templates): Promise<void> {
    await this.writeSnapshot({ version: TEMPLATE_SCHEMA_VERSION, updatedAt: new Date().toISOString(), data: templates });
  }
}

/** Plans in Postgres (one row per plan), replace-the-collection semantics like templates. */
export class PostgresPlansRepository implements PlansRepository {
  private lastRead = new Map<string, string>();

  public constructor(private readonly gateway: RowGateway) {}

  public async readSnapshot(): Promise<PlansSnapshot | null> {
    const rows = await this.gateway.selectAll<PlanRow>("plans");
    if (rows.length === 0) {
      this.lastRead = new Map();
      return null;
    }
    const data = rowsToPlans(rows.filter((row) => row.deleted_at == null));
    this.lastRead = new Map(data.map((plan) => [plan.id, fingerprint(plan)]));
    return { version: PLANS_SCHEMA_VERSION, updatedAt: latestUpdatedAt(rows), data };
  }

  public async writeSnapshot(snapshot: PlansSnapshot): Promise<void> {
    const userId = await this.gateway.requireUserId();
    const rows = plansToRows(userId, snapshot.data);
    const byId = new Map(snapshot.data.map((plan) => [plan.id, plan]));
    const changed = rows.filter((row) => this.lastRead.get(row.id) !== fingerprint(byId.get(row.id)));
    await writeRespectingLimits({
      rows: changed,
      exists: (row) => this.lastRead.has(row.id),
      upsert: (batch) => this.gateway.upsertRows("plans", batch),
      deleteRemoved: () => this.gateway.deleteMissing("plans", rows.map((row) => row.id)),
      onWritten: (row) => this.lastRead.set(row.id, fingerprint(byId.get(row.id))),
    });
    this.lastRead = new Map(rows.map((row) => [row.id, fingerprint(byId.get(row.id))]));
  }

  public async readPlans(): Promise<Plan[]> {
    return (await this.readSnapshot())?.data ?? [];
  }

  public async writePlans(plans: Plan[]): Promise<void> {
    await this.writeSnapshot({ version: PLANS_SCHEMA_VERSION, updatedAt: new Date().toISOString(), data: plans });
  }

  public async readActivePlanId(): Promise<string | null> {
    return null;
  }

  public async writeActivePlanId(): Promise<void> {
    // The active plan is a per-device preference and is not synced (same as the API-backed repository).
  }
}

interface UserSettingsRow {
  user_id: string;
  active_plan_id: string | null;
  plan_params: PlanParams | null;
  plan_meta: GeneratedPlanMeta | null;
  updated_at?: string;
}

// Database CHECK limits (see core_tables): oversized values are dropped rather than failing the whole write.
const withinBytes = (value: unknown, max: number): boolean => JSON.stringify(value).length <= max;

/**
 * The per-account preferences row (one row per user). Only the columns this repository owns are written, so
 * other columns of user_settings (such as the AI provider) are left alone by the upsert.
 */
export class PostgresAccountSettingsRepository implements AccountSettingsRepository {
  private lastRead: string | null = null;

  public constructor(private readonly gateway: RowGateway) {}

  public async readSnapshot(): Promise<SettingsSnapshot | null> {
    const rows = await this.gateway.selectAll<UserSettingsRow>("user_settings");
    if (rows.length === 0) {
      this.lastRead = null;
      return null;
    }
    const [row] = rows;
    const data = {
      activePlanId: row.active_plan_id ?? null,
      planParams: row.plan_params ?? null,
      planMeta: row.plan_meta ?? null,
    };
    this.lastRead = fingerprint(data);
    return { version: 1, updatedAt: row.updated_at ?? new Date().toISOString(), data };
  }

  public async writeSnapshot(snapshot: SettingsSnapshot): Promise<void> {
    if (this.lastRead === fingerprint(snapshot.data)) return;
    const userId = await this.gateway.requireUserId();
    const { activePlanId, planParams, planMeta } = snapshot.data;
    const row: UserSettingsRow = {
      user_id: userId,
      active_plan_id: activePlanId && activePlanId.length <= 100 ? activePlanId : null,
      plan_params: planParams && withinBytes(planParams, 10000) ? planParams : null,
      plan_meta: planMeta && withinBytes(planMeta, 20000) ? planMeta : null,
    };
    await this.gateway.upsertRows("user_settings", [row]);
    this.lastRead = fingerprint(snapshot.data);
  }
}
