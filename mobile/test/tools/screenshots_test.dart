import 'dart:io';
import 'dart:ui' as ui;

import 'package:daily_grind/api/subscription.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';

/// A developer tool, not a test of behaviour: renders the real screens with real fonts to PNG files so a person can look at
/// them. Skipped unless SCREENSHOT_DIR is set:
///
///   SCREENSHOT_DIR=build/screens flutter test test/tools/screenshots_test.dart
///
/// (The default test font draws every letter as a square, which makes a normal screenshot useless.)
final _dir = Platform.environment['SCREENSHOT_DIR'];

Future<void> _loadFonts() async {
  final root = Platform.environment['FLUTTER_ROOT']!;
  final fonts = '$root/bin/cache/artifacts/material_fonts';
  Future<ByteData> bytes(String name) async => ByteData.sublistView(await File('$fonts/$name').readAsBytes());

  final roboto = FontLoader('Roboto')
    ..addFont(bytes('Roboto-Regular.ttf'))
    ..addFont(bytes('Roboto-Medium.ttf'))
    ..addFont(bytes('Roboto-Bold.ttf'));
  await roboto.load();
  final icons = FontLoader('MaterialIcons')..addFont(bytes('MaterialIcons-Regular.otf'));
  await icons.load();
}

Future<void> _shot(WidgetTester tester, String name, GlobalKey key) async {
  await tester.runAsync(() async {
    final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final ui.Image image = await boundary.toImage(pixelRatio: 2);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    final file = File('$_dir/$name.png')..createSync(recursive: true);
    await file.writeAsBytes(Uint8List.view(data!.buffer));
  });
}

void main() {
  final skip = _dir == null ? 'set SCREENSHOT_DIR to render screenshots' : false;

  Future<void> scene(WidgetTester tester, {required Size size, required Brightness brightness, required String prefix, bool settings = false}) async {
    await tester.runAsync(_loadFonts);
    debugDisableShadows = false;
    final key = GlobalKey();
    final h = await pumpDashboard(
      tester,
      size: size,
      subscription: const SubscriptionInfo(plan: 'free', status: 'inactive'),
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true, fontFamily: 'Roboto', brightness: brightness),
      boundaryKey: key,
      seed: (s) async {
        await s.templateRepo.writeTemplates({
          'tennis': const TemplateData(main: [TemplateRow(id: 't', text: 'Rally')]),
          'push': const TemplateData(
            label: 'Push day',
            focus: 'Chest, shoulders and triceps',
            source: 'ai',
            warmup: [
              TemplateRow(id: 'w1', text: 'Arm circles', target: '2 x 10'),
              TemplateRow(id: 'w2', text: 'Band pull-aparts', target: '2 x 15', equipment: 'Resistance band'),
            ],
            main: [
              TemplateRow(id: 'm1', text: 'Bench press', target: '3 x 8', equipment: 'Barbell', description: 'Shoulder blades back, feet planted, lower to mid-chest.'),
              TemplateRow(id: 'm2', text: 'Overhead press', target: '3 x 10', videoUrl: 'https://example.com/ohp'),
              TemplateRow(id: 'm3', text: 'Triceps pushdown', target: '3 x 12'),
            ],
          ),
          'pull': const TemplateData(label: 'Pull day', source: 'ai', main: [TemplateRow(id: 'p1', text: 'Row')]),
        });
        await s.plansRepo.writePlans(const [
          Plan(id: 'p', label: 'PPL', sessionIds: ['push', 'pull'], schedule: {'0': 'push', '2': 'pull', '5': 'push'}),
        ]);
        await s.plansRepo.writeActivePlanId('p');
        final push = (await s.templateRepo.readTemplates())!['push']!;
        WorkoutItem item(TemplateRow r, {bool done = false}) =>
            WorkoutItem(id: r.id!, text: r.text, target: r.target, equipment: r.equipment, description: r.description, videoUrl: r.videoUrl, done: done);
        await s.workoutRepo.saveDay(DayData(
          date: '2026-10-03',
          sessionType: 'push',
          warmup: [item(push.warmup[0], done: true), item(push.warmup[1], done: true)],
          main: [item(push.main[0], done: true), item(push.main[1]), item(push.main[2])],
          warmupTimerMs: 312000,
          mainTimerMs: 1260000,
          mainNotes: 'Bench felt strong — add 2.5 kg next week.',
          weight: '79.5',
          checkNotes: 'Slept well',
        ));
      },
    );
    await _shot(tester, '$prefix-dashboard-top', key);
    await tester.drag(find.byType(Scrollable).first, Offset(0, -size.height * 0.6));
    await tester.pumpAndSettle();
    await _shot(tester, '$prefix-dashboard-scrolled', key);
    if (settings) {
      await h.openSettings(tester);
      await _shot(tester, '$prefix-settings', key);
    }
    debugDisableShadows = true; // the framework requires it restored before the test ends
  }

  uiTest('light phone', skip: skip, (t) => scene(t, size: const Size(420, 880), brightness: Brightness.light, prefix: '1-phone-light', settings: true));
  uiTest('dark phone', skip: skip, (t) => scene(t, size: const Size(420, 880), brightness: Brightness.dark, prefix: '2-phone-dark', settings: true));
  uiTest('editors', skip: skip, (tester) async {
    await tester.runAsync(_loadFonts);
    debugDisableShadows = false;
    final key = GlobalKey();
    final h = await pumpDashboard(
      tester,
      size: const Size(420, 1500),
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true, fontFamily: 'Roboto'),
      boundaryKey: key,
      seed: (s) async {
        await s.templateRepo.writeTemplates({
          'tennis': const TemplateData(main: [TemplateRow(id: 't', text: 'Rally')]),
          'push': const TemplateData(
            label: 'Push day',
            source: 'ai',
            videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
            warmup: [TemplateRow(id: 'w1', text: 'Arm circles', target: '2 x 10')],
            main: [
              TemplateRow(id: 'm1', text: 'Bench press', target: '3 x 8', equipment: 'Barbell', description: 'Shoulder blades back, feet planted.'),
              TemplateRow(id: 'm2', text: 'Overhead press', target: '3 x 10', videoUrl: 'https://youtu.be/dQw4w9WgXcQ'),
              TemplateRow(id: 'm3', text: 'Triceps pushdown', target: '3 x 12'),
            ],
          ),
          'pull': const TemplateData(label: 'Pull day', source: 'ai', main: [TemplateRow(id: 'p1', text: 'Row')]),
        });
        await s.plansRepo.writePlans(const [
          Plan(id: 'p', label: 'PPL', sessionIds: ['push', 'pull'], schedule: {'0': 'push', '2': 'pull', '5': 'push'}),
          Plan(id: 'q', label: 'Light week', sessionIds: ['pull']),
        ]);
        await s.plansRepo.writeActivePlanId('p');
      },
    );
    await h.openSettings(tester);
    tester.view.physicalSize = const Size(420, 1500);
    await tester.pumpAndSettle();
    final scrollable = find.byType(Scrollable).first;
    await tester.drag(scrollable, const Offset(0, -250));
    await tester.pumpAndSettle();
    await _shot(tester, '5-editor-template', key);
    await tester.drag(scrollable, const Offset(0, -1100));
    await tester.pumpAndSettle();
    await _shot(tester, '6-editor-plans', key);
    debugDisableShadows = true;
  });

  uiTest('tablet', skip: skip, (t) => scene(t, size: const Size(1000, 760), brightness: Brightness.light, prefix: '3-tablet'));
}

