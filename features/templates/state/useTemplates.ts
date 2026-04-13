import { useCallback, useEffect, useRef, useState } from "react";
import { TemplateService } from "../../../application/workout/TemplateService";
import { TEMPLATES } from "../../../constants";
import { SessionType, TemplateData, Templates } from "../../../types";
import { TemplateValidationError, validateTemplateRows } from "../../../application/workout/templates/templateRules";
import { CreateSessionTypeResult, DeleteSessionTypeResult, RenameSessionTypeResult } from "../../../application/workout/sessionTypes/sessionTypeRules";

interface UseTemplatesResult {
  templates: Templates;
  isLoaded: boolean;
  lastError: string | null;
  saveSectionTemplate: (
    session: SessionType,
    section: keyof TemplateData,
    rows: TemplateData[keyof TemplateData]
  ) => TemplateValidationError[];
  undoSectionTemplate: (session: SessionType, section: keyof TemplateData) => void;
  resetSectionTemplate: (session: SessionType, section: keyof TemplateData) => void;
  addSessionType: (label: string) => Promise<CreateSessionTypeResult>;
  removeSessionType: (sessionType: SessionType) => Promise<DeleteSessionTypeResult>;
  renameSessionType: (oldType: SessionType, newLabel: string) => Promise<RenameSessionTypeResult>;
}

/**
 * Manages editable session templates and persists user changes.
 */
export function useTemplates(service: TemplateService): UseTemplatesResult {
  const [templates, setTemplates] = useState<Templates>(TEMPLATES);
  const [isLoaded, setIsLoaded] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [history, setHistory] = useState<
    Partial<Record<SessionType, Partial<Record<keyof TemplateData, TemplateData[keyof TemplateData]>>>>
  >({});
  const historyRef = useRef(history);
  historyRef.current = history;

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      try {
        const loaded = await service.loadTemplates();
        if (!isCancelled) {
          setTemplates(loaded);
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
  }, [service]);

  const saveSectionTemplate = useCallback(
    (session: SessionType, section: keyof TemplateData, rows: TemplateData[keyof TemplateData]) => {
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
        void service.saveTemplates(next).catch(() => {
          setLastError("Failed to save template changes.");
        });
        return next;
      });
      return [];
    },
    [service]
  );

  const undoSectionTemplate = useCallback(
    (session: SessionType, section: keyof TemplateData) => {
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
        void service.saveTemplates(next).catch(() => {
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
    [service]
  );

  const resetSectionTemplate = useCallback(
    (session: SessionType, section: keyof TemplateData) => {
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
        void service.saveTemplates(next).catch(() => {
          setLastError("Failed to save template changes.");
        });
        return next;
      });
    },
    [service]
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
        await service.saveTemplates(result.templates);
        return result;
      } catch {
        setLastError("Failed to save template changes.");
        return {
          status: "error",
          message: "Failed to save template changes.",
        };
      }
    },
    [service, templates]
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
        await service.saveTemplates(result.templates);
        return result;
      } catch {
        setLastError("Failed to save template changes.");
        return {
          status: "error",
          message: "Failed to save template changes.",
        };
      }
    },
    [service, templates]
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
        await service.saveTemplates(result.templates);
        return result;
      } catch {
        setLastError("Failed to save template changes.");
        return { status: "error", message: "Failed to save template changes." };
      }
    },
    [service, templates]
  );

  return {
    templates,
    isLoaded,
    lastError,
    saveSectionTemplate,
    undoSectionTemplate,
    resetSectionTemplate,
    addSessionType,
    removeSessionType,
    renameSessionType,
  };
}