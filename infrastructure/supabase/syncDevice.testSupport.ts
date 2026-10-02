import { SyncService } from "../../application/sync/SyncService";
import { SyncAllowance } from "../../application/sync/syncAllowance";
import { SyncSettings, SyncSettingsRepository } from "../../interfaces/sync/SyncSettingsRepository";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { TemplateRepository } from "../../interfaces/workout/TemplateRepository";
import { TemplateSnapshot, WorkoutDataSnapshot } from "../../application/sync/syncTypes";
import { Tombstones } from "../../application/sync/deletionReconciliation";
import { EMPTY_SYNC_BASE, SyncBase } from "../../application/sync/syncMerge";
import { dayContentHash } from "../../application/sync/contentHash";
import { sanitizeDayData, sanitizeDayDataRecord } from "../../application/workout/data/dayDataRules";
import { sanitizeTemplates } from "../../application/workout/templates/templateRules";
import { TEMPLATES } from "../../constants";
import { DayData, TemplateData, Templates } from "../../types";
import { FakeGateway } from "./fakeGateway.testSupport";
import { PostgresTemplateRepository, PostgresWorkoutDataRepository } from "./PostgresRepositories";

/**
 * Test support: one device running the real sync service and the real Postgres repositories against a fake database,
 * with local storage doubles that behave like the real local repositories (JSON on disk, sanitized when read).
 */

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const stamp = () => new Date().toISOString();
export const tpl = (text: string): TemplateData => ({ warmup: [], main: [{ text, target: "3x8" }] });

export function day(date: string, notes: string): DayData {
  return sanitizeDayDataRecord(
    { [date]: { date, sessionType: "gym", warmup: [], main: [], warmupNotes: "", mainNotes: notes, warmupTimerMs: 0, mainTimerMs: 0, weight: "", checkNotes: "" } as DayData },
    TEMPLATES
  )[date];
}

/** Like LocalStorageTemplateRepository: stored as JSON, and sanitized when read, so it has the same shape as the cloud copy. */
export class LocalTemplates implements TemplateRepository {
  public snapshot: TemplateSnapshot | null = null;
  public set(data: Templates) { this.snapshot = { version: 1, updatedAt: stamp(), data: clone(sanitizeTemplates(data)) }; }
  public get data(): Templates { return this.snapshot ? sanitizeTemplates(this.snapshot.data) : {}; }
  public async readTemplates() { return this.snapshot ? this.data : null; }
  public async writeTemplates() {}
  public async readSnapshot(): Promise<TemplateSnapshot | null> {
    return this.snapshot ? { ...clone(this.snapshot), data: this.data } : null;
  }
  public async writeSnapshot(next: TemplateSnapshot) { this.snapshot = clone(next); }
}

/** Mirrors LocalStorageWorkoutDataRepository's tombstone rules. */
export class LocalDays implements WorkoutDataRepository {
  public data: Record<string, DayData> = {};
  public tombstones: Tombstones = {};
  public async readAll() { return this.data; }
  public async writeAll(data: Record<string, DayData>) { await this.writeSnapshot({ version: 1, updatedAt: stamp(), data }); }
  public async readSnapshot(): Promise<WorkoutDataSnapshot | null> {
    return { version: 1, updatedAt: stamp(), data: sanitizeDayDataRecord(clone(this.data), TEMPLATES), deletedDays: { ...this.tombstones } };
  }
  public async writeSnapshot(next: WorkoutDataSnapshot) {
    this.data = clone(next.data);
    for (const date of Object.keys(this.data)) delete this.tombstones[date];
    if (next.deletedDays) for (const date of Object.keys(this.tombstones)) if (!(date in next.deletedDays)) delete this.tombstones[date];
  }
  public userDeletes(date: string) {
    // Like LocalStorageWorkoutDataRepository: the tombstone is the hash of the sanitized day.
    this.tombstones[date] = dayContentHash(sanitizeDayData(this.data[date], date, TEMPLATES));
    delete this.data[date];
  }
}

export class SyncSettingsMemory implements SyncSettingsRepository {
  public settings: SyncSettings = { mode: "cloud", lastSyncedAt: null, lastError: null };
  public base: SyncBase = EMPTY_SYNC_BASE;
  public async readSettings() { return this.settings; }
  public async writeSettings(settings: SyncSettings) { this.settings = settings; }
  public async readSyncBase() { return this.base; }
  public async writeSyncBase(base: SyncBase) { this.base = base; }
  public async readRestorePoints() { return []; }
  public async writeRestorePoints() {}
}

export function newDevice(gateway: FakeGateway, options: { allowance?: Pick<SyncAllowance, "begin">; ownership?: { check(): Promise<"ok" | "otherAccount"> } } = {}) {
  const templates = new LocalTemplates();
  const days = new LocalDays();
  const settings = new SyncSettingsMemory();
  const service = new SyncService({
    settingsRepository: settings,
    allowance: options.allowance,
    ownership: options.ownership,
    localWorkoutRepository: days,
    localTemplateRepository: templates,
    // A fresh repository per sync, like opening the app: nothing carried over except what the sync recorded.
    cloudWorkoutRepository: new PostgresWorkoutDataRepository(gateway),
    cloudTemplateRepository: new PostgresTemplateRepository(gateway),
  });
  return {
    templates,
    days,
    settings,
    sync: () => service.syncNow({}, { automatic: true }),
    /** What the Sync now button does. */
    syncByHand: () => service.syncNow({}, { automatic: false }),
    /** The automatic sync of a Free account: brings the cloud's data here and sends nothing. */
    syncDownloadOnly: () => service.syncNow({}, { automatic: true, downloadOnly: true }),
  };
}
