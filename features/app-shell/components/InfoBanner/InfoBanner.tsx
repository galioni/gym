import React from "react";
import { Scale } from "lucide-react";

interface InfoBannerProps {
  content: string | null;
}

/**
 * Small contextual banner for day-level reminders. Renders nothing when content is null.
 */
export const InfoBanner: React.FC<InfoBannerProps> = ({ content }) => {
  if (!content) return null;
  return (
    <div className="motion-rise rounded-2xl border border-primary/30 bg-primary/10 p-3 md:p-4 flex items-center gap-3 text-sm text-orange-100">
      <Scale size={16} className="text-primary shrink-0" />
      {content}
    </div>
  );
};
