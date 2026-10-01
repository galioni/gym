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

const fingerprint = (value: unknown): string => hashString(stableSerialize(value));

/**
 * Workout days in Postgres (one row per day). Writes upsert only the days that differ from what the last
 * read returned, so a sync touches the rows that changed and the server-owned updated_at stays meaningful.
 * Deletions arrive as snapshot.deletedDays and become soft deletes (see deletionReconciliation).
 */
export class PostgresWorkoutDataRepository implements WorkoutDataRepository {
  private lastRead = new Map<string, string>();

  public constructor(private readonly gateway: RowGateway) {}

  public async readSnapshot(): Promise<WorkoutDataSnapshot | null> {
    const rows = await this.gateway.selectAll<WorkoutDayRow>("workout_days");
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
    if (changed.length > 0) {
      await this.gateway.upsertRows("workout_days", changed);
      for (const row of changed) this.lastRead.set(row.day, dayContentHash(snapshot.data[row.day]));
    }

    const toDelete = snapshot.deletedDays ?? {};
    if (Object.keys(toDelete).length > 0) {
      await this.gateway.markDaysDeleted(toDelete);
      for (const date of Object.keys(toDelete)) this.lastRead.delete(date);
    }
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
    if (changed.length > 0) {
      await this.gateway.upsertRows("templates", changed);
    }
    await this.gateway.deleteMissing("templates", rows.map((row) => row.session_type));
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
    if (changed.length > 0) {
      await this.gateway.upsertRows("plans", changed);
    }
    await this.gateway.deleteMissing("plans", rows.map((row) => row.id));
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
