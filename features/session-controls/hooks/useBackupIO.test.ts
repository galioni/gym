import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBackupIO } from "./useBackupIO";
import {
  STORAGE_KEY,
  SYNC_RESTORE_POINTS_STORAGE_KEY,
  SYNC_SETTINGS_STORAGE_KEY,
  TEMPLATE_STORAGE_KEY,
} from "../../../constants";

const mockShowToast = vi.fn();
const mockConfirm = vi.fn().mockResolvedValue(true);

vi.mock("../../feedback/hooks/useFeedback", () => ({
  useFeedback: () => ({ showToast: mockShowToast, confirm: mockConfirm }),
}));

function makeLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    _store: store,
  };
}

function makeValidEnvelope(overrides?: object) {
  return JSON.stringify({
    version: 1,
    exportedAt: "2026-04-13T10:00:00.000Z",
    stores: {
      workout: JSON.stringify({ "2026-04-13": { sessionType: "gym" } }),
      templates: null,
      syncSettings: null,
      syncRestorePoints: null,
    },
    ...overrides,
  });
}

function fireFileRead(content: string) {
  const MockFileReader = vi.fn().mockImplementation(function () {
    const reader = {
      onload: null as ((e: { target: { result: string } }) => void) | null,
      readAsText: vi.fn().mockImplementation(function () {
        setTimeout(() => {
          reader.onload?.({ target: { result: content } });
        }, 0);
      }),
    };
    return reader;
  });
  vi.stubGlobal("FileReader", MockFileReader);
}

describe("useBackupIO", () => {
  let storage: ReturnType<typeof makeLocalStorageMock>;

  beforeEach(() => {
    storage = makeLocalStorageMock();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:mock"),
      revokeObjectURL: vi.fn(),
    });
    mockShowToast.mockClear();
    mockConfirm.mockClear();
    mockConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("exportBackup", () => {
    it("shows an info toast when there is no data to export", () => {
      const { result } = renderHook(() => useBackupIO());
      act(() => result.current.exportBackup());
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: "info" })
      );
    });

    it("triggers a download and shows success toast when data exists", () => {
      storage.setItem(STORAGE_KEY, JSON.stringify({ "2026-04-13": {} }));
      const appendSpy = vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
      const removeSpy = vi.spyOn(document.body, "removeChild").mockImplementation((node) => node);

      const { result } = renderHook(() => useBackupIO());
      act(() => result.current.exportBackup());

      expect(appendSpy).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: "success", title: "Backup exported" })
      );
    });
  });

  describe("handleImportFileChange", () => {
    it("writes all stores from a valid full backup envelope", async () => {
      fireFileRead(makeValidEnvelope());
      const { result } = renderHook(() => useBackupIO());
      const file = new File([makeValidEnvelope()], "backup.json", { type: "application/json" });
      const event = { target: { files: [file], value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        result.current.handleImportFileChange(event);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(storage._store[STORAGE_KEY]).toBeDefined();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: "success", title: "Backup imported" })
      );
    });

    it("does not write anything when the user cancels the confirm", async () => {
      mockConfirm.mockResolvedValue(false);
      fireFileRead(makeValidEnvelope());
      const { result } = renderHook(() => useBackupIO());
      const file = new File(["{}"], "backup.json", { type: "application/json" });
      const event = { target: { files: [file], value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        result.current.handleImportFileChange(event);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(storage._store[STORAGE_KEY]).toBeUndefined();
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it("shows an error toast for invalid JSON", async () => {
      fireFileRead("this is not json {{{");
      const { result } = renderHook(() => useBackupIO());
      const file = new File(["this is not json {{{"], "bad.json", { type: "application/json" });
      const event = { target: { files: [file], value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        result.current.handleImportFileChange(event);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: "error" })
      );
      expect(storage._store[STORAGE_KEY]).toBeUndefined();
    });

    it("rejects a backup with corrupted store values", async () => {
      const corrupted = JSON.stringify({
        version: 1,
        exportedAt: "2026-04-13T10:00:00.000Z",
        stores: {
          workout: "not valid json {{{",
          templates: null,
          syncSettings: null,
          syncRestorePoints: null,
        },
      });
      fireFileRead(corrupted);
      const { result } = renderHook(() => useBackupIO());
      const file = new File([corrupted], "backup.json", { type: "application/json" });
      const event = { target: { files: [file], value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        result.current.handleImportFileChange(event);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: "error", title: "Invalid backup file" })
      );
      expect(storage._store[STORAGE_KEY]).toBeUndefined();
    });

    it("handles legacy backup format (plain workout JSON string)", async () => {
      const legacyContent = JSON.stringify({ "2026-01-01": { sessionType: "gym" } });
      fireFileRead(legacyContent);
      const { result } = renderHook(() => useBackupIO());
      const file = new File([legacyContent], "legacy.json", { type: "application/json" });
      const event = { target: { files: [file], value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        result.current.handleImportFileChange(event);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(storage._store[STORAGE_KEY]).toBe(legacyContent);
      expect(storage._store[TEMPLATE_STORAGE_KEY]).toBeUndefined();
      expect(storage._store[SYNC_SETTINGS_STORAGE_KEY]).toBeUndefined();
    });

    it("does nothing when no file is selected", async () => {
      const { result } = renderHook(() => useBackupIO());
      const event = { target: { files: [], value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        result.current.handleImportFileChange(event);
      });

      expect(mockShowToast).not.toHaveBeenCalled();
      expect(mockConfirm).not.toHaveBeenCalled();
    });
  });
});
