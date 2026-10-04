import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:daily_grind/domain/week_plan.dart';
import 'package:flutter_test/flutter_test.dart';

// 2026-10-05 is a Monday, so the week is 05 (Mo) .. 11 (Su).
const mon = '2026-10-05', tue = '2026-10-06', wed = '2026-10-07', thu = '2026-10-08', fri = '2026-10-09', sun = '2026-10-11';

DayData day(String date, String session, {bool done = false}) => DayData(
      date: date,
      sessionType: session,
      main: [WorkoutItem(id: 'i-$date', text: 'x', done: done)],
    );

void main() {
  test('the week of any day runs Monday to Sunday, across month and year ends', () {
    expect(weekDates('2026-10-09'), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(weekDates('2026-10-11').first, '2026-10-05', reason: 'a Sunday belongs to the week before it');
    expect(weekDates('2026-10-05').first, '2026-10-05');
    expect(weekDates('2026-10-01'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(weekDates('2027-01-01').first, '2026-12-28');
  });

  test('a day is done once any item is ticked', () {
    expect(isDayDone(day(mon, 'gym', done: true)), isTrue);
    expect(isDayDone(day(mon, 'gym')), isFalse);
  });

  group('a scheduled plan', () {
    const plan = Plan(id: 'p', label: 'PPL', sessionIds: ['push', 'pull', 'legs'], schedule: {'0': 'push', '2': 'pull', '4': 'legs'});

    WeekPlanView view(Map<String, DayData> data, String date, [String session = 'push']) =>
        buildWeekPlan(plan: plan, allData: data, currentDate: date, currentSessionType: session)!;

    test('lists the scheduled days with their day names; the first unfinished slot from today is next', () {
      final v = view({}, tue, 'pull');
      expect(v.label, 'PPL');
      expect(v.pills.map((p) => p.dayLabel), ['Mo', 'We', 'Fr']);
      expect(v.pills.map((p) => p.sessionType), ['push', 'pull', 'legs']);
      expect(v.pills.map((p) => p.isNext), [false, true, false]);
      expect(v.pills[0].isOverdue, isTrue, reason: 'Monday passed without a session');
      expect(v.pills[1].isCurrent, isTrue, reason: 'the day on screen is a pull day');
    });

    test('a ticked day only counts for the slot if it is the scheduled session', () {
      expect(view({mon: day(mon, 'push', done: true)}, tue).pills[0].done, isTrue);
      expect(view({mon: day(mon, 'legs', done: true)}, tue).pills[0].done, isFalse);
      expect(view({mon: day(mon, 'push')}, tue).pills[0].done, isFalse, reason: 'present but nothing ticked');
    });

    test('when nothing is left from today onward, the earliest unfinished slot is next', () {
      final v = view({wed: day(wed, 'pull', done: true), fri: day(fri, 'legs', done: true)}, sun);
      expect(v.pills.map((p) => p.done), [false, true, true]);
      expect(v.pills[0].isNext, isTrue);
      expect(v.allDone, isFalse);
    });

    test('everything done is a completed week', () {
      final v = view({
        mon: day(mon, 'push', done: true),
        wed: day(wed, 'pull', done: true),
        fri: day(fri, 'legs', done: true),
      }, thu);
      expect(v.allDone, isTrue);
      expect(v.pills.every((p) => p.done), isTrue);
    });

    test('a done slot is neither current, next nor overdue', () {
      final v = view({mon: day(mon, 'push', done: true)}, thu, 'push');
      final p = v.pills.first;
      expect([p.done, p.isCurrent, p.isNext, p.isOverdue], [true, false, false, false]);
    });

    test('an empty schedule falls back to the ordered list', () {
      const ordered = Plan(id: 'p', label: 'A', sessionIds: ['push'], schedule: {});
      final v = buildWeekPlan(plan: ordered, allData: {}, currentDate: mon, currentSessionType: 'push')!;
      expect(v.pills.single.dayLabel, isNull);
    });
  });

  group('an ordered plan', () {
    const plan = Plan(id: 'p', label: 'Week', sessionIds: ['gym', 'swim', 'gym']);

    WeekPlanView view(Map<String, DayData> data, [String session = 'gym']) =>
        buildWeekPlan(plan: plan, allData: data, currentDate: wed, currentSessionType: session)!;

    test('nothing done: the first slot is next and the current session is highlighted', () {
      final v = view({}, 'swim');
      expect(v.pills.map((p) => p.isNext), [true, false, false]);
      expect(v.pills.map((p) => p.isCurrent), [false, true, false]);
      expect(v.pills.every((p) => p.dayLabel == null && !p.isOverdue), isTrue);
    });

    test('each ticked day uses up one slot of its session type, in order', () {
      final v = view({mon: day(mon, 'gym', done: true)});
      expect(v.pills.map((p) => p.done), [true, false, false]);
      final both = view({mon: day(mon, 'gym', done: true), thu: day(thu, 'gym', done: true)});
      expect(both.pills.map((p) => p.done), [true, false, true], reason: 'the second gym day fills the second gym slot');
      expect(both.pills[1].isNext, isTrue);
    });

    test('more ticked days than slots does not over-count', () {
      final v = view({mon: day(mon, 'swim', done: true), tue: day(tue, 'swim', done: true), thu: day(thu, 'swim', done: true)});
      expect(v.pills.map((p) => p.done), [false, true, false]);
    });

    test('days outside the shown week do not count', () {
      expect(view({'2026-10-04': day('2026-10-04', 'gym', done: true), '2026-10-12': day('2026-10-12', 'gym', done: true)}).pills.any((p) => p.done), isFalse);
    });

    test('all slots done is a completed week; no sessions at all shows nothing', () {
      final all = view({mon: day(mon, 'gym', done: true), tue: day(tue, 'swim', done: true), fri: day(fri, 'gym', done: true)});
      expect(all.allDone, isTrue);
      const empty = Plan(id: 'p', label: 'E', sessionIds: []);
      expect(buildWeekPlan(plan: empty, allData: {}, currentDate: wed, currentSessionType: 'gym'), isNull);
    });
  });

  test('the scheduled session for a weekday', () {
    const plan = Plan(id: 'p', label: 'P', sessionIds: ['push'], schedule: {'0': 'push', '6': 'rest'});
    expect(scheduledSessionFor(plan, DateTime(2026, 10, 5)), 'push');
    expect(scheduledSessionFor(plan, DateTime(2026, 10, 11)), 'rest');
    expect(scheduledSessionFor(plan, DateTime(2026, 10, 7)), isNull);
    expect(scheduledSessionFor(null, DateTime(2026, 10, 5)), isNull);
    expect(scheduledSessionFor(const Plan(id: 'q', label: 'Q', sessionIds: []), DateTime(2026, 10, 5)), isNull);
  });
}
