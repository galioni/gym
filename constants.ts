import { SessionOption, SessionType, TemplateData, Templates } from './types';
export const PLANS_STORAGE_KEY = "daily-workout-tracker:plans:v1";
export const ACTIVE_PLAN_STORAGE_KEY = "daily-workout-tracker:active-plan:v1";

export const STORAGE_KEY = "daily-workout-tracker:v2";
export const TEMPLATE_STORAGE_KEY = "daily-workout-tracker:templates:v1";
export const SYNC_SETTINGS_STORAGE_KEY = "daily-workout-tracker:sync-settings:v1";
export const SYNC_RESTORE_POINTS_STORAGE_KEY = "daily-workout-tracker:sync-restore-points:v1";
export const ONBOARDING_STORAGE_KEY = "daily-workout-tracker:onboarded:v1";
export const PLAN_PARAMS_STORAGE_KEY = "daily-workout-tracker:plan-params:v1";
export const PLAN_META_STORAGE_KEY = "daily-workout-tracker:plan-meta:v1";
export const STORAGE_SCHEMA_VERSION = 1;
export const TEMPLATE_SCHEMA_VERSION = 1;
export const PLANS_SCHEMA_VERSION = 1;
export const TEMPLATE_TEXT_MAX_LENGTH = 80;
export const TEMPLATE_TARGET_MAX_LENGTH = 40;
export const DEFAULT_SESSION_TYPE: SessionType = 'tennis';

export const DEFAULT_SESSION_OPTIONS: SessionOption[] = [
  { value: 'tennis', label: 'Tennis day (warm-up + strength mini)' },
  { value: 'gym', label: 'Gym day (full session)' },
  { value: 'swim', label: 'Swim day (short warm-up)' },
  { value: 'rest', label: 'Rest / Recovery' },
];

export const EMPTY_TEMPLATE: TemplateData = {
  warmup: [],
  main: [],
};

export const TEMPLATES: Templates = {
  tennis: {
    warmup: [
      { text: "2-3 min brisk walk / light jog", target: "Raise heart rate" },
      { text: "Joint prep: ankles, hips, T-spine (30-60s)", target: "Loosen up" },
      { text: "Dynamic legs: leg swings + lunges (2 x 6 each)", target: "Open hips" },
      { text: "Shoulder prep: arm circles + band pull-aparts (2 x 10)", target: "Shoulders ready" },
      { text: "Wrist/forearm prep (30-60s)", target: "Tennis comfort" },
      { text: "Easy shadow swings (1-2 min)", target: "Groove form" }
    ],
    main: [
      { text: "Strength (30 min): squat pattern", target: "2-3 sets" },
      { text: "Strength hinge pattern", target: "2-3 sets" },
      { text: "Strength push (press)", target: "2-3 sets" },
      { text: "Strength pull (row)", target: "2-3 sets" },
      { text: "Core: plank / deadbug", target: "2-3 sets" },
      { text: "Tennis session (60 min)", target: "Focus: consistency" },
      { text: "Cool-down: walk + light stretch (5 min)", target: "Downshift" }
    ]
  },
  gym: {
    warmup: [
      { text: "5 min easy cardio (walk/bike)", target: "Warm body" },
      { text: "Mobility: hips + T-spine (2-3 min)", target: "Move well" },
      { text: "2 ramp-up sets for first lift", target: "Prepare load" }
    ],
    main: [
      { text: "Leg Press", target: "3x8-12" },
      { text: "Chest Press", target: "3x8-12" },
      { text: "Lat Pulldown", target: "3x8-12" },
      { text: "Seated Row", target: "3x8-12" },
      { text: "Plank", target: "3 sets" }
    ]
  },
  swim: {
    warmup: [
      { text: "2-3 min brisk walk", target: "Warm body" },
      { text: "Shoulders: circles + light band work (2 x 10)", target: "Protect shoulders" }
    ],
    main: [
      { text: "Swim (30 min)", target: "Easy/moderate" },
      { text: "Cool-down: easy float / stretch", target: "Relax" }
    ]
  },
  rest: {
    warmup: [],
    main: [
      { text: "10-20 min walk", target: "Recovery" },
      { text: "5-10 min mobility", target: "Loosen up" }
    ]
  }
};