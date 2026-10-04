# Contract tests (web <-> Flutter)

The Flutter client in `../mobile` must hash, merge, sanitise and word things exactly as the web app does, or two devices on
different clients would disagree about what changed. These tests make the web the source of truth:

1. `*.contract.test.ts(x)` here run the **real web code** and write what it produced to `*.fixtures.json`.
2. `../mobile/test/contract/*_test.dart` replay those fixtures against the Dart port. A difference fails the Dart test.

| Test | Covers |
|---|---|
| `contentHash`, `sanitize` | the content hash (including explicit `undefined` keys) and every sanitiser |
| `syncMerge` | three-way merge, deletions, `agreedBase`, `agreedDaysBase`, partial-write bases, the history window |
| `syncScenarios` | 27 multi-device scenarios through the real web `SyncService` and a fake database, step by step; the Dart `SyncService` must end in the same state |
| `api` | request and response shapes of the Vercel API the apps call |
| `dashboard`, `editors`, `history` | labels, ordering, wording and calculations shown to people |

Regenerate the fixtures after an **intentional** change to the web behaviour:

```bash
UPDATE_CONTRACT=1 npx vitest run contract   # rewrites contract/*.fixtures.json
cd mobile && flutter test test/contract      # the Dart side must now agree, or be fixed
```

Without `UPDATE_CONTRACT` the tests compare against the committed fixtures, so an accidental change in web behaviour fails here.

**Rule:** a change to sync, hashing or sanitising lands in the web code, the Dart code and the fixtures together, in one change.

The suite is included through `vitest.config.ts` (`contract/**/*.test.{ts,tsx}`).
