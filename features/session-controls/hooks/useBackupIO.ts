import { ChangeEvent, RefObject, useRef } from "react";
import {
  STORAGE_KEY,
  SYNC_RESTORE_POINTS_STORAGE_KEY,
  SYNC_SETTINGS_STORAGE_KEY,
  TEMPLATE_STORAGE_KEY,
} from "../../../constants";
import { toLocalDateKey } from "../../../utils";
import { useFeedback } from "../../feedback/hooks/useFeedback";

interface UseBackupIOResult {
  fileInputRef: RefObject<HTMLInputElement | null>;
  exportBackup: () => void;
  openImportPicker: () => void;
  handleImportFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

interface FullBackupEnvelope {
  version: 1;
  exportedAt: string;
  stores: {
    workout: string | null;
    templates: string | null;
    syncSettings: string | null;
    syncRestorePoints: string | null;
  };
}

function isFullBackupEnvelope(value: unknown): value is FullBackupEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<FullBackupEnvelope>;
  return candidate.version === 1 && Boolean(candidate.stores);
}

/**
 * Centralizes backup export/import side effects so header UI stays presentation-focused.
 */
export function useBackupIO(): UseBackupIOResult {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { confirm, showToast } = useFeedback();

  const exportBackup = () => {
    try {
      const stores: FullBackupEnvelope["stores"] = {
        workout: localStorage.getItem(STORAGE_KEY),
        templates: localStorage.getItem(TEMPLATE_STORAGE_KEY),
        syncSettings: localStorage.getItem(SYNC_SETTINGS_STORAGE_KEY),
        syncRestorePoints: localStorage.getItem(SYNC_RESTORE_POINTS_STORAGE_KEY),
      };
      if (!stores.workout && !stores.templates && !stores.syncSettings && !stores.syncRestorePoints) {
        showToast({ tone: "info", title: "No data to export", description: "Create or import data first." });
        return;
      }

      const payload: FullBackupEnvelope = {
        version: 1,
        exportedAt: new Date().toISOString(),
        stores,
      };
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `workout-backup-${toLocalDateKey(new Date())}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      showToast({ tone: "success", title: "Backup exported" });
    } catch (error) {
      console.error(error);
      showToast({ tone: "error", title: "Export failed", description: "Could not create the backup file." });
    }
  };

  const openImportPicker = () => {
    fileInputRef.current?.click();
  };

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const json = loadEvent.target?.result as string;
        const parsed = JSON.parse(json) as unknown;

        const shouldImport = await confirm({
          title: "Replace existing data?",
          description: "Import will overwrite workout, templates, and sync settings with this backup.",
          confirmLabel: "Import Backup",
          cancelLabel: "Cancel",
          tone: "danger",
        });
        if (!shouldImport) {
          return;
        }

        if (isFullBackupEnvelope(parsed)) {
          const stores = parsed.stores;
          const writeStore = (key: string, value: string | null) => {
            if (value === null) {
              localStorage.removeItem(key);
              return;
            }
            localStorage.setItem(key, value);
          };
          writeStore(STORAGE_KEY, stores.workout);
          writeStore(TEMPLATE_STORAGE_KEY, stores.templates);
          writeStore(SYNC_SETTINGS_STORAGE_KEY, stores.syncSettings);
          writeStore(SYNC_RESTORE_POINTS_STORAGE_KEY, stores.syncRestorePoints);
        } else {
          // Backward compatibility: old backups contained only workout payload.
          localStorage.setItem(STORAGE_KEY, json);
        }
        showToast({ tone: "success", title: "Backup imported", description: "Reloading with restored data..." });
        window.setTimeout(() => window.location.reload(), 450);
      } catch {
        showToast({ tone: "error", title: "Invalid backup file", description: "Please select a valid JSON backup." });
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  return {
    fileInputRef,
    exportBackup,
    openImportPicker,
    handleImportFileChange,
  };
}
