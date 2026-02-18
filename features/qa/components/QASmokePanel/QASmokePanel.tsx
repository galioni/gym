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
    <aside className="max-w-4xl mx-auto mt-6 mb-24 px-4">
      <div className="glass rounded-2xl p-4 border border-white/10">
        <h3 className="display-title text-xl text-white">QA Smoke Panel</h3>
        <p className="text-xs text-slate-400 uppercase tracking-[0.16em] mt-1">Visible only with ?qa=1</p>
        <ul className="mt-4 space-y-2">
          {cases.map((qaCase) => (
            <li key={qaCase.name} className="flex items-start justify-between gap-4 border border-white/10 rounded-xl p-3">
              <div>
                <div className="text-sm font-semibold text-white">{qaCase.name}</div>
                <div className="text-xs text-slate-400 mt-1">{qaCase.detail}</div>
              </div>
              <span className={qaCase.pass ? "text-accent text-xs font-bold" : "text-red-300 text-xs font-bold"}>
                {qaCase.pass ? "PASS" : "FAIL"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
};
