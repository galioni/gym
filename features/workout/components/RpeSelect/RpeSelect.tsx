import React from "react";

interface RpeSelectProps {
  value: string;
  onChange: (value: string) => void;
  mobile?: boolean;
}

/**
 * Reusable RPE picker for both desktop panel header and mobile inline controls.
 */
export const RpeSelect: React.FC<RpeSelectProps> = ({ value, onChange, mobile = false }) => {
  if (mobile) {
    return (
      <div className="flex items-center gap-2 bg-surface/60 border border-white/10 rounded-xl px-3 py-2">
        <span className="text-xs text-slate-400 font-bold uppercase tracking-[0.18em]">RPE</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="bg-transparent text-sm text-primary font-bold outline-none"
          title="Rate of Perceived Exertion"
        >
          <option value="">--</option>
          {[4, 5, 6, 7, 8, 9, 10].map((rpeValue) => (
            <option key={rpeValue} value={rpeValue}>
              {rpeValue}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="mr-4 hidden sm:block">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-surface/70 border border-white/10 rounded-lg px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-primary outline-none"
        title="Rate of Perceived Exertion"
      >
        <option value="">RPE -</option>
        {[4, 5, 6, 7, 8, 9, 10].map((rpeValue) => (
          <option key={rpeValue} value={rpeValue}>
            {rpeValue}
          </option>
        ))}
      </select>
    </div>
  );
};
