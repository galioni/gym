import { ChangeEvent, RefObject, useRef } from "react";
import { STORAGE_KEY } from "../../../constants";

interface UseBackupIOResult {
  fileInputRef: RefObject<HTMLInputElement | null>;
  exportBackup: () => void;
  openImportPicker: () => void;
  handleImportFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Centralizes backup export/import side effects so header UI stays presentation-focused.
 */
export function useBackupIO(): UseBackupIOResult {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportBackup = () => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) {
        alert("No data to export!");
        return;
      }

      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `workout-backup-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      alert("Failed to export data.");
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
    reader.onload = (loadEvent) => {
      try {
        const json = loadEvent.target?.result as string;
        JSON.parse(json);

        if (confirm("This will replace ALL your current data. Are you sure?")) {
          localStorage.setItem(STORAGE_KEY, json);
          window.location.reload();
        }
      } catch {
        alert("Invalid backup file.");
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
