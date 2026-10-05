import { useCallback, useEffect, useRef, useState } from "react";
import { useStaleReadGuard } from "../../sync/state/useStaleReadGuard";
import { TemplateService } from "../../../application/workout/TemplateService";
import { TEMPLATES } from "../../../constants";
import { SessionType, TemplateData, TemplateSectionKey, Templates } from "../../../types";
import { TemplateValidationError, validateTemplateRows } from "../../../application/workout/templates/templateRules";
import { CreateSessionTypeResult, DeleteSessionTypeResult, RenameSessionTypeResult } from "../../../application/workout/sessionTypes/sessionTypeRules";

interface UseTemplatesResult {
  templates: Templates;
  isLoaded: boolean;
  lastError: string | null;
  saveSectionTemplate: (
    session: SessionType,
    section: TemplateSectionKey,
    rows: TemplateData[TemplateSectionKey]
  ) => TemplateValidationError[];
  saveTemplateVideoUrl: (session: SessionType, videoUrl: string | undefined) => void;
  undoSectionTemplate: (session: SessionType, section: TemplateSectionKey) => void;
  resetSectionTemplate: (session: SessionType, section: TemplateSectionKey) => void;
  replaceTemplates: (templates: Templates) => Promise<void>;
  addSessionType: (label: string) => Promise<CreateSessionTypeResult>;
  removeSessionType: (sessionType: SessionType) => Promise<DeleteSessionTypeResult>;
  renameSessionType: (oldType: SessionType, newLabel: string) => Promise<RenameSessionTypeResult>;
}

/**
 * Manages editable session templates and persists user changes.
 */
export function useTemplates(service: TemplateService, reloadToken = 0): UseTemplatesResult {
  const [templates, setTemplates] = useState<Templates>(TEMPLATES);
  const { track, readFresh } = useStaleReadGuard();
  const [isLoaded, setIsLoaded] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [history, setHistory] = useState<
    Partial<Record<SessionType, Partial<Record<TemplateSectionKey, TemplateData[TemplateSectionKey]>>>>
  >({});
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  });

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      try {
        // Not a read that an edit overtook (see useStaleReadGuard): that would undo the edit on screen.
        const fresh = await readFresh(() => service.loadTemplates(), () => isCancelled);
        if (fresh && !isCancelled) {
          setTemplates(fresh.value);
        }
      } catch (error) {
        console.error("Failed to load templates", error);
      } finally {
        if (!isCancelled) {
          setIsLoaded(true);
        }
      }
    };

    void load();
    return () => {
      isCancelled = true;
    };
  }, [service, reloadToken, readFresh]);

  const saveSectionTemplate = useCallback(
    (session: SessionType, section: TemplateSectionKey, rows: TemplateData[TemplateSectionKey]) => {
      const validationErrors = validateTemplateRows(rows);
      if (validationErrors.length > 0) {
        return validationErrors;
      }

      setLastError(null);
      setTemplates((previous) => {
        setHistory((historyState) => ({
          ...historyState,
          [session]: {
            ...historyState[session],
            [section]: previous[session][section].map((row) => ({ ...row })),
          },
        }));

        const next = {
          ...previous,
          [session]: {
            ...previous[session],
            [section]: rows,
          },
        };
        void track(service.saveTemplates(next)).catch(() => {
          setLastError("Failed to save template changes.");
        });
        return next;
      });
      return [];
    },
    [service, track]
  );

  const undoSectionTemplate = useCallback(
    (session: SessionType, section: TemplateSectionKey) => {
      const previousValue = historyRef.current[session]?.[section];
      if (!previousValue) {
        return;
      }

      setLastError(null);
      setTemplates((current) => {
        const next = {
          ...current,
          [session]: {
            ...current[session],
            [section]: previousValue.map((row) => ({ ...row })),
          },
        };
        void track(service.saveTemplates(next)).catch(() => {
          setLastError("Failed to save template changes.");
        });
        return next;
      });

      setHistory((current) => ({
        ...current,
        [session]: {
          ...current[session],
          [section]: undefined,
        },
      }));
    },
    [service, track]
  );

  const resetSectionTemplate = useCallback(
    (session: SessionType, section: TemplateSectionKey) => {
      setLastError(null);
      setTemplates((current) => {
        setHistory((historyState) => ({
          ...historyState,
          [session]: {
            ...historyState[session],
            [section]: current[session][section].map((row) => ({ ...row })),
          },
        }));

        const next = {
          ...current,
          [session]: {
            ...current[session],
            [section]: service.getDefaultSection(session, section),
          },
        };
        void track(service.saveTemplates(next)).catch(() => {
          setLastError("Failed to save template changes.");
        });
        return next;
      });
    },
    [service, track]
  );

  const saveTemplateVideoUrl = useCallback(
    (session: SessionType, videoUrl: string | undefined) => {
      setLastError(null);
      setTemplates((previous) => {
        const next = {
          ...previous,
          [session]: {
            ...previous[session],
            videoUrl: videoUrl || undefined,
          },
        };
        void track(service.saveTemplates(next)).catch(() => {
          setLastError("Failed to save template changes.");
        });
        return next;
      });
    },
    [service, track]
  );

  const replaceTemplates = useCallback(
    async (newTemplates: Templates): Promise<void> => {
      setTemplates(newTemplates);
      await track(service.saveTemplates(newTemplates));
    },
    [service, track]
  );

  const addSessionType = useCallback(
    async (label: string): Promise<CreateSessionTypeResult> => {
      const result = service.createSessionType(templates, label);
      if (result.status === "error" || !result.templates || !result.sessionType) {
        return result;
      }

      setLastError(null);
      setTemplates(result.templates);
      try {
        await track(service.saveTemplates(result.templates));
        return result;
      } catch {
        setLastError("Failed to save template changes.");
        return {
          status: "error",
          message: "Failed to save template changes.",
        };
      }
    },
    [service, templates, track]
  );

  const removeSessionType = useCallback(
    async (sessionType: SessionType): Promise<DeleteSessionTypeResult> => {
      const result = service.deleteSessionType(templates, sessionType);
      if (result.status === "error" || !result.templates) {
        return result;
      }

      setLastError(null);
      setTemplates(result.templates);
      try {
        await track(service.saveTemplates(result.templates));
        return result;
      } catch {
        setLastError("Failed to save template changes.");
        return {
          status: "error",
          message: "Failed to save template changes.",
        };
      }
    },
    [service, templates, track]
  );

  const renameSessionType = useCallback(
    async (oldType: SessionType, newLabel: string): Promise<RenameSessionTypeResult> => {
      const result = service.renameSessionType(templates, oldType, newLabel);
      if (result.status === "error" || !result.templates || !result.newSessionType) {
        return result;
      }

      setLastError(null);
      setTemplates(result.templates);
      try {
        await track(service.saveTemplates(result.templates));
        return result;
      } catch {
        setLastError("Failed to save template changes.");
        return { status: "error", message: "Failed to save template changes." };
      }
    },
    [service, templates, track]
  );

  return {
    templates,
    isLoaded,
    lastError,
    saveSectionTemplate,
    saveTemplateVideoUrl,
    undoSectionTemplate,
    resetSectionTemplate,
    replaceTemplates,
    addSessionType,
    removeSessionType,
    renameSessionType,
  };
}