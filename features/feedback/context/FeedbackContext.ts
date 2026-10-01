import React from "react";
import { FeedbackContextValue } from "../types/feedbackTypes";

export const FeedbackContext = React.createContext<FeedbackContextValue | undefined>(undefined);
