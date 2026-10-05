/// Light, dark, or follow the phone (the web app's Appearance setting). A preference of this device, not of the account: it is not
/// synced, and it survives signing out and signing in as someone else.
library;

import 'package:flutter/material.dart';

import '../data/local_database.dart';

enum ThemePreference {
  light('light', ThemeMode.light),
  dark('dark', ThemeMode.dark),
  system('system', ThemeMode.system);

  const ThemePreference(this.wire, this.mode);

  final String wire;
  final ThemeMode mode;

  static ThemePreference? fromWire(Object? value) {
    for (final p in values) {
      if (p.wire == value) return p;
    }
    return null;
  }
}

class ThemeController extends ChangeNotifier {
  ThemeController(this._database) : _preference = ThemePreference.fromWire(_database?.readDoc(storageKey)) ?? defaultPreference;

  /// Starts with [preference] and keeps nothing (tests, previews).
  ThemeController.inMemory([ThemePreference preference = defaultPreference])
      : _database = null,
        _preference = preference;

  /// The web app's default too, so the same account looks the same on both.
  static const defaultPreference = ThemePreference.light;

  /// Keys starting with `device.` are kept when an account's data is cleared from the device (see SqliteSyncOwner).
  static const storageKey = 'device.theme';

  final LocalDatabase? _database;
  ThemePreference _preference;

  ThemePreference get preference => _preference;
  ThemeMode get mode => _preference.mode;

  void select(ThemePreference next) {
    if (next == _preference) return;
    _preference = next;
    _database?.writeDoc(storageKey, next.wire);
    notifyListeners();
  }
}
