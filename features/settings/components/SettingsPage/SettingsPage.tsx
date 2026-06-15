import React from "react";
import { ArrowLeft, Download, Sparkles, Trash2, Upload } from "lucide-react";
import { TemplateEditor } from "../../../templates/components/TemplateEditor/TemplateEditor";
import { SyncSettingsPanel } from "../../../sync/components/SyncSettingsPanel/SyncSettingsPanel";
import { PlansEditor } from "../../../plans/components/PlansEditor/PlansEditor";
import { Card } from "../../../../components/ui/Card";
import { Button } from "../../../../components/ui/Button";
import { Plan, PlanParams, SessionOption, SessionType, TemplateData, Templates } from "../../../../types";
import { SyncConflict, SyncNowResult, SyncRestorePoint } from "../../../../application/sync/syncTypes";
import { TemplateValidationError } from "../../../../application/workout/templates/templateRules";
import {
  CreateSessionTypeResult,
  DeleteSessionTypeResult,
  RenameSessionTypeResult,
} from "../../../../application/workout/sessionTypes/sessionTypeRules";
import { ExerciseLibraryEntry } from "../../../../application/workout/exerciseLibrary";
import { useBackupIO } from "../../../session-controls/hooks/useBackupIO";
import { PushNotificationsCard } from "../../../push/components/PushNotificationsCard";
import { AiProviderSelector } from "../AiProviderSelector";
import { useAuthSession } from "../../../auth/hooks/useAuthSession";
import { useFeedback } from "../../../feedback/hooks/useFeedback";
import { useSubscription } from "../../../billing/hooks/useSubscription";
import { APP_THEME_OPTIONS, AppTheme } from "../../../theme/constants/themeOptions";
import { WeightReminderSettings } from "../../../weight-reminder/hooks/useWeightReminder";
import {
  STORAGE_KEY,
  SYNC_RESTORE_POINTS_STORAGE_KEY,
  SYNC_SETTINGS_STORAGE_KEY,
  TEMPLATE_STORAGE_KEY,
  PLANS_STORAGE_KEY,
  ACTIVE_PLAN_STORAGE_KEY,
} from "../../../../constants";

interface SettingsPageProps {
  onBack: () => void;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  weightReminder: WeightReminderSettings;
  onUpdateWeightReminder: (updates: Partial<WeightReminderSettings>) => void;
  templates: Templates;
  sessionOptions: SessionOption[];
  templateSaveError: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  syncMessage: string;
  conflicts: SyncConflict[];
  restorePoints: SyncRestorePoint[];
  isSyncing: boolean;
  onSaveSectionTemplate: (
    session: SessionType,
    section: keyof TemplateData,
    rows: TemplateData[keyof TemplateData]
  ) => TemplateValidationError[];
  onUndoSectionTemplate: (session: SessionType, section: keyof TemplateData) => void;
  onResetSectionTemplate: (session: SessionType, section: keyof TemplateData) => void;
  onCreateSessionType: (label: string) => Promise<CreateSessionTypeResult>;
  onDeleteSessionType: (sessionType: SessionType) => Promise<DeleteSessionTypeResult>;
  onRenameSessionType: (oldType: SessionType, newLabel: string) => Promise<RenameSessionTypeResult>;
  isUpgradeRequired: boolean;
  onSyncNow: (
    resolution?: Partial<Record<string, "keepLocal" | "keepCloud">>
  ) => Promise<SyncNowResult>;
  onRollback: (id: string) => Promise<SyncNowResult>;
  onPruneRestorePoints: () => Promise<void>;
  planParams?: PlanParams;
  onRegeneratePlan: () => void;
  plans: Plan[];
  activePlanId: string | null;
  onCreatePlan: (label: string, sessionIds: string[]) => Promise<Plan>;
  onUpdatePlan: (id: string, updates: Partial<Pick<Plan, "label" | "sessionIds">>) => Promise<void>;
  onDeletePlan: (id: string) => Promise<void>;
  onSetActivePlan: (id: string | null) => Promise<void>;
  exerciseLibrary: ExerciseLibraryEntry[];
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  onBack,
  theme,
  onThemeChange,
  weightReminder,
  onUpdateWeightReminder,
  templates,
  sessionOptions,
  templateSaveError,
  lastSyncedAt,
  lastSyncError,
  syncMessage,
  conflicts,
  restorePoints,
  isSyncing,
  onSaveSectionTemplate,
  onUndoSectionTemplate,
  onResetSectionTemplate,
  onCreateSessionType,
  onDeleteSessionType,
  onRenameSessionType,
  isUpgradeRequired,
  onSyncNow,
  onRollback,
  onPruneRestorePoints,
  planParams,
  onRegeneratePlan,
  plans,
  activePlanId,
  onCreatePlan,
  onUpdatePlan,
  onDeletePlan,
  onSetActivePlan,
  exerciseLibrary,
}) => {
  const { fileInputRef, exportBackup, openImportPicker, handleImportFileChange } = useBackupIO();
  const { signOut, session } = useAuthSession();
  const { confirm, showToast } = useFeedback();
  const { subscription, isLoading: isSubscriptionLoading, fetchError: subscriptionFetchError, startCheckout, openBillingPortal } = useSubscription();

  const handleDeleteAllData = async () => {
    const confirmed = await confirm({
      title: "Delete account and all data?",
      description:
        "This permanently removes your account, all workout history, templates, and cloud sync data. You will be signed out. This cannot be undone.",
      confirmLabel: "Delete everything",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!confirmed) return;

    // Clear local storage first so data is gone even if the API call fails.
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TEMPLATE_STORAGE_KEY);
    localStorage.removeItem(SYNC_SETTINGS_STORAGE_KEY);
    localStorage.removeItem(SYNC_RESTORE_POINTS_STORAGE_KEY);
    localStorage.removeItem(PLANS_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY);

    // Delete server-side data and the auth account.
    // Sign out locally regardless of whether the API call succeeds.
    if (session?.accessToken) {
      try {
        const response = await fetch("/api/delete-account", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? "Server deletion failed");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        showToast({
          tone: "error",
          title: "Server data deletion failed",
          description: `Local data cleared. Server error: ${message}. Contact support if cloud data persists.`,
        });
      }
    }

    await signOut();
  };

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-5 sm:space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      <TemplateEditor
        templates={templates}
        sessionOptions={sessionOptions}
        saveError={templateSaveError}
        onSaveSection={onSaveSectionTemplate}
        onUndoSection={onUndoSectionTemplate}
        onResetSection={onResetSectionTemplate}
        onCreateSessionType={onCreateSessionType}
        onDeleteSessionType={onDeleteSessionType}
        onRenameSessionType={onRenameSessionType}
        exerciseLibrary={exerciseLibrary}
      />

      {/* Plans */}
      <Card title="Plans">
        <div className="text-xs text-slate-500 mb-3">
          Group sessions into named plans. Activate a plan to filter the session dropdown in the header.
          Sessions are shared — the same session can belong to multiple plans.
        </div>
        <PlansEditor
          plans={plans}
          activePlanId={activePlanId}
          sessionOptions={sessionOptions}
          onCreatePlan={onCreatePlan}
          onUpdatePlan={onUpdatePlan}
          onDeletePlan={onDeletePlan}
          onSetActivePlan={onSetActivePlan}
        />
      </Card>

      {/* Plan */}
      <Card title="Plan">
        {isSubscriptionLoading ? (
          <div className="text-sm text-slate-400">Loading...</div>
        ) : subscriptionFetchError ? (
          <div className="text-sm text-slate-400">Could not load subscription status. Please refresh and try again.</div>
        ) : subscription.plan === "pro" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-white">Pro</div>
                {subscription.currentPeriodEnd && (
                  <div className="text-xs text-slate-400 mt-0.5">
                    Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                  </div>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={() => void openBillingPortal().catch(() => showToast({ tone: "error", title: "Could not open billing portal. Try again." }))}>
                Manage subscription
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-slate-300">
              You're on the <span className="font-semibold text-white">free plan</span>. Upgrade to Pro to enable cloud sync across devices.
            </div>
            <Button variant="primary" size="sm" className="gap-2" onClick={() => void startCheckout().catch(() => showToast({ tone: "error", title: "Could not start checkout. Try again." }))}>
              Upgrade to Pro
            </Button>
          </div>
        )}
      </Card>

      <SyncSettingsPanel
        lastSyncedAt={lastSyncedAt}
        lastError={lastSyncError}
        syncMessage={syncMessage}
        conflicts={conflicts}
        restorePoints={restorePoints}
        isSyncing={isSyncing}
        isUpgradeRequired={isUpgradeRequired}
        onSyncNow={onSyncNow}
        onRollback={onRollback}
        onPruneRestorePoints={onPruneRestorePoints}
        onUpgrade={startCheckout}
      />

      {/* Reminders */}
      <Card title="Reminders">
        <div className="space-y-4">
          <div className="flex items-center justify-between min-h-[44px]">
            <div>
              <div className="text-sm text-slate-300">Friday weight check</div>
              <div className="text-xs text-slate-500 mt-0.5">Banner shown on Fridays from midnight until the target time</div>
            </div>
            <div className="flex items-center min-h-[44px] pl-4">
              <button
                type="button"
                role="switch"
                aria-checked={weightReminder.enabled}
                onClick={() => onUpdateWeightReminder({ enabled: !weightReminder.enabled })}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                  weightReminder.enabled ? "bg-primary" : "bg-white/20"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform ${
                    weightReminder.enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {weightReminder.enabled && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Target time</span>
              <input
                type="time"
                value={weightReminder.targetTime}
                onChange={(e) => onUpdateWeightReminder({ targetTime: e.target.value })}
                className="bg-background/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
              />
            </div>
          )}
        </div>
      </Card>

      <PushNotificationsCard />

      {/* Appearance */}
      <Card title="Appearance">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-300">Theme</span>
          <select
            value={theme}
            onChange={(e) => onThemeChange(e.target.value as AppTheme)}
            className="bg-background/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
          >
            {APP_THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {/* AI Plan */}
      <Card title="AI Plan">
        <AiProviderSelector />
        {planParams && (
          <div className="text-xs text-slate-500 mb-3">
            {[
              planParams.goal.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
              planParams.experience.replace(/^./, (c) => c.toUpperCase()),
              `${planParams.daysPerWeek} days/week`,
              planParams.equipment.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
              `${planParams.duration} min`,
              ...(planParams.bodyFocus.length > 0
                ? [planParams.bodyFocus.map((f) => f.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())).join(", ")]
                : []),
            ].join(" · ")}
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-300">Regenerate your AI workout plan</div>
            <div className="text-xs text-slate-500 mt-0.5">Answer a few questions and Claude will build a personalised set of session templates from scratch. This replaces your existing templates.</div>
          </div>
          <Button variant="secondary" size="sm" className="gap-2 shrink-0" onClick={onRegeneratePlan}>
            <Sparkles size={14} />
            Regenerate
          </Button>
        </div>
      </Card>

      {/* Data */}
      <Card title="Data">
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="secondary" size="sm" className="gap-2 flex-1 justify-center" onClick={exportBackup}>
              <Download size={14} />
              Export Backup
            </Button>
            <Button variant="secondary" size="sm" className="gap-2 flex-1 justify-center" onClick={openImportPicker}>
              <Upload size={14} />
              Import Backup
            </Button>
          </div>

          <div className="pt-2 border-t border-white/10">
            <Button
              variant="danger"
              size="sm"
              className="w-full gap-2 justify-center"
              onClick={() => void handleDeleteAllData()}
            >
              <Trash2 size={14} />
              Delete account and all data
            </Button>
            <p className="mt-2 text-xs text-slate-500 text-center">
              Permanently deletes your account, all workout history, templates, and cloud data. Cannot be undone.
            </p>
          </div>
        </div>
      </Card>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportFileChange}
        accept=".json"
        className="hidden"
      />
    </main>
  );
};
