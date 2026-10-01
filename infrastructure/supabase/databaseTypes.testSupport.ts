import type { Database } from "./database.types";
import type { PlanRow, TemplateRow, WorkoutDayRow } from "./postgresRows";

/**
 * Compile-time check (it runs inside `tsc --noEmit`, not at runtime): the hand-written row types must have exactly the
 * columns of the real tables, and every plain (non-JSON) column must have the same type. A migration that adds, renames or
 * retypes a column fails the type-check until `database.types.ts` is regenerated and `postgresRows.ts` follows.
 */
type Rows = Database["public"]["Tables"];

type SameColumns<Mine, Real> = [keyof Mine] extends [keyof Real] ? ([keyof Real] extends [keyof Mine] ? true : never) : never;

type PlainColumns<Mine, Real> = {
  [K in keyof Mine & keyof Real as Real[K] extends string | number | boolean | null ? K : never]-?: Real[K] extends Mine[K] | undefined
    ? true
    : false;
};
type AllTrue<T> = false extends T[keyof T] ? never : true;

export const rowTypesMatchTheDatabase: [
  SameColumns<WorkoutDayRow, Rows["workout_days"]["Row"]>,
  SameColumns<TemplateRow, Rows["templates"]["Row"]>,
  SameColumns<PlanRow, Rows["plans"]["Row"]>,
  AllTrue<PlainColumns<WorkoutDayRow, Rows["workout_days"]["Row"]>>,
  AllTrue<PlainColumns<TemplateRow, Rows["templates"]["Row"]>>,
  AllTrue<PlainColumns<PlanRow, Rows["plans"]["Row"]>>,
] = [true, true, true, true, true, true];
