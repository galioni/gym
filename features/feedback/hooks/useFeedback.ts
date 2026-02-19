import { useContext } from "react";
import { FeedbackContext } from "../context/FeedbackProvider";
import { FeedbackContextValue } from "../types/feedbackTypes";

/**
 * Accesses app-wide toast and confirm helpers from the feedback provider.
 */
export function useFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error("useFeedback must be used inside FeedbackProvider");
  }
  return context;
}
