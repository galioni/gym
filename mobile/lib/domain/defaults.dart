/// Built-in session templates and storage constants, mirroring the web app's `constants.ts`.
library;

import 'templates.dart';

const storageSchemaVersion = 1;
const templateSchemaVersion = 1;
const plansSchemaVersion = 1;
const templateTextMaxLength = 80;
const templateTargetMaxLength = 40;
const defaultSessionType = 'tennis';

const emptyTemplate = TemplateData();

const defaultTemplates = <String, TemplateData>{
  'tennis': TemplateData(
    warmup: [
      TemplateRow(text: '2-3 min brisk walk / light jog', target: 'Raise heart rate'),
      TemplateRow(text: 'Joint prep: ankles, hips, T-spine (30-60s)', target: 'Loosen up'),
      TemplateRow(text: 'Dynamic legs: leg swings + lunges (2 x 6 each)', target: 'Open hips'),
      TemplateRow(text: 'Shoulder prep: arm circles + band pull-aparts (2 x 10)', target: 'Shoulders ready'),
      TemplateRow(text: 'Wrist/forearm prep (30-60s)', target: 'Tennis comfort'),
      TemplateRow(text: 'Easy shadow swings (1-2 min)', target: 'Groove form'),
    ],
    main: [
      TemplateRow(text: 'Strength (30 min): squat pattern', target: '2-3 sets'),
      TemplateRow(text: 'Strength hinge pattern', target: '2-3 sets'),
      TemplateRow(text: 'Strength push (press)', target: '2-3 sets'),
      TemplateRow(text: 'Strength pull (row)', target: '2-3 sets'),
      TemplateRow(text: 'Core: plank / deadbug', target: '2-3 sets'),
      TemplateRow(text: 'Tennis session (60 min)', target: 'Focus: consistency'),
      TemplateRow(text: 'Cool-down: walk + light stretch (5 min)', target: 'Downshift'),
    ],
  ),
  'gym': TemplateData(
    warmup: [
      TemplateRow(text: '5 min easy cardio (walk/bike)', target: 'Warm body'),
      TemplateRow(text: 'Mobility: hips + T-spine (2-3 min)', target: 'Move well'),
      TemplateRow(text: '2 ramp-up sets for first lift', target: 'Prepare load'),
    ],
    main: [
      TemplateRow(text: 'Leg Press', target: '3x8-12'),
      TemplateRow(text: 'Chest Press', target: '3x8-12'),
      TemplateRow(text: 'Lat Pulldown', target: '3x8-12'),
      TemplateRow(text: 'Seated Row', target: '3x8-12'),
      TemplateRow(text: 'Plank', target: '3 sets'),
    ],
  ),
  'swim': TemplateData(
    warmup: [
      TemplateRow(text: '2-3 min brisk walk', target: 'Warm body'),
      TemplateRow(text: 'Shoulders: circles + light band work (2 x 10)', target: 'Protect shoulders'),
    ],
    main: [
      TemplateRow(text: 'Swim (30 min)', target: 'Easy/moderate'),
      TemplateRow(text: 'Cool-down: easy float / stretch', target: 'Relax'),
    ],
  ),
  'rest': TemplateData(
    warmup: [],
    main: [
      TemplateRow(text: '10-20 min walk', target: 'Recovery'),
      TemplateRow(text: '5-10 min mobility', target: 'Loosen up'),
    ],
  ),
};
