import React, { useEffect, useState } from "react";
import { runWorkoutSmokeChecks, SmokeCaseResult } from "../../../../application/workout/qa/runWorkoutSmokeChecks";

/**
 * Dev-only smoke checks that mirror the shared QA suite used by automated tests.
 */
export const QASmokePanel: React.FC = () => {
  const [cases, setCases] = useState<SmokeCaseResult[]>([]);

  useEffect(() => {
    const runChecks = async () => {
      const results = await runWorkoutSmokeChecks();
      setCases(results);
    };

    void runChecks();
  }, []);

  return (
    <aside className="max-w-4xl mx-auto mt-6 mb-[calc(var(--sticky-footer-height,0px)+1.5rem)] px-4">
      <div className="glass rounded-2xl p-4 border border-border">
        <h3 className="display-title text-xl text-label">QA Smoke Panel</h3>
        <p className="text-xs text-labelSecondary uppercase tracking-[0.12em] mt-1">Visible only with ?qa=1</p>
        <ul className="mt-4 space-y-2">
          {cases.map((qaCase) => (
            <li key={qaCase.name} className="flex items-start justify-between gap-4 border border-border rounded-xl p-3">
              <div>
                <div className="text-sm font-semibold text-label">{qaCase.name}</div>
                <div className="text-xs text-labelSecondary mt-1">{qaCase.detail}</div>
              </div>
              <span className={qaCase.pass ? "text-accentText text-xs font-bold" : "text-dangerText text-xs font-bold"}>
                {qaCase.pass ? "PASS" : "FAIL"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
};
