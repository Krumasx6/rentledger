# RentLedger

A fully offline, single-owner rental ledger for Android, built with Expo SDK 58, React Native, TypeScript, Expo Router, and expo-sqlite. No accounts, server, cloud sync, subscription, or payment service. The production database starts empty.

## Run

Use Node.js 24 LTS and the SDK 58-compatible Expo Go app on your Android phone.

```sh
npm ci
npx expo start --go
```

Scan the terminal QR code using Expo Go. The development computer and phone normally need to be on the same network to load the JavaScript bundle. Once loaded, ledger operations use only local storage; a standalone installed build does not need Metro. No native project generation or emulator is required to develop the core app in Expo Go.

Use an SDK 58-compatible Expo Go build. Launch online first and sign in to the same Expo account in the terminal and on the phone. `--offline` requires an already cached project development certificate when Expo Go requests manifest signing; it cannot create that certificate. If the phone reports a missing `ExpoSQLite` native module, check its Expo Go SDK/runtime or use a fresh development build. See [PRINTING.md](PRINTING.md) for the native development build commands required for Bluetooth.

```sh
npx tsc --noEmit
npx expo lint
npm test
npx expo install --check
npx expo-doctor
npx expo export --platform android --output-dir dist
```

Tests use Node 24's built-in SQLite and test runner. They transpile and execute the actual repository code with a small SQLite bridge adapter; only the Expo UUID provider is replaced. They use isolated databases and never touch the phone database. The file-backed persistence test creates and removes only its own temporary files. No seeded data is shipped.

## Build an installable Android APK

The `preview` profile in `eas.json` produces a signed standalone APK with package ID `com.krumasx6.rentledger`. It runs without Expo Go or Metro after installation. This workspace uses local signing credentials in `credentials.json` and `.signing/rentledger.jks`; both are excluded from Git. Keep a private backup of both files so future APKs can update the installed app with the same signing identity. Do not share or commit these signing files.

```powershell
cd E:\Projects\rentledger
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

Use the Expo account that owns the linked EAS project. The preview build reads the existing local signing credentials; it does not need cloud keystore generation. EAS uploads the project source and required signing material and builds in the cloud; it does not push a GitHub commit. Follow the resulting build link on your Android phone, download the APK, and allow installation from that browser if Android asks. The `production` profile produces an AAB for a future Play Store release instead and uses EAS-managed signing unless separately configured to reuse the local credentials.

Export your Expo Go ledger and import it into the installed APK to transfer existing records: they have separate app storage. Keep the package ID and signing keystore consistent for future app updates.

## Features

- **Dashboard:** month navigation, collected and expected rent, remaining balance, fully paid and outstanding counts, collection progress, tenant search, and quick actions. Outstanding charges sort first.
- **Tenants:** create and edit contact details, room, rent, due day, and notes; choose a rental start month; view monthly balances and payment history; archive without losing historical records.
- **Records and payments:** browse past and future billing months, record partial or full payments, keep multiple payments per charge, and correct or delete mistakes with confirmation. Each payment has a stable receipt identifier, date, billing month, amount, and optional note.
- **Settings:** share JSON backups, validate imports, review counts, and explicitly confirm replacement. Includes device-only storage guidance and an About screen.

## Accounting and storage rules

- The source of truth is `rentledger.db` in the app's SQLite storage, provided by `SQLiteProvider`. Records survive app restarts. React state holds form input and view selection, not financial records.
- Version 3 migrations use `PRAGMA user_version`, WAL journaling, foreign keys, checks, indexes, and a unique `(tenantId, month)` charge key. Existing version-1 and version-2 databases upgrade transactionally, preserving tenants, rental rates, charges, payments, and settings. Newer unknown database versions are rejected rather than overwritten.
- Due days accept whole numbers from **1 to 31**. When a month is shorter than the chosen due day, the actual due date is that month's final day: day 31 becomes April 30, February 28, or February 29 in a leap year. The recurring due day remains unchanged, so March still uses March 31. Monthly charge snapshots preserve the due-day terms that were originally charged.
- Tables: `tenants`, `rates` (effective-month rental terms), `charges` (monthly snapshots), `payments` (individual transactions), `settings` (business/printer preferences), `receipts` (immutable snapshots and correction history), and `print_attempts` (transmission outcomes).
- Monetary values are integer centavos. Decimal input accepts at most two places; extra precision, non-finite values, zero, negative amounts, and amounts above ₱1 billion are rejected. There is no floating-point money rounding.
- Month keys are local `YYYY-MM`; payment dates are validated local calendar `YYYY-MM-DD`. UTC conversion is used only for the backup's export timestamp.
- Eligible monthly charges are generated **on opening that billing month**, using `INSERT OR IGNORE`. No charge is generated before the rental start month or after the archived final month. Unopened months can be visited later without losing their original rental terms.
- A new tenant's first rate starts in their rental start month. Editing rent or due day takes effect next calendar month, or the rental start month if that is further in the future. Existing charges are never rewritten, including future charges already opened. The edit form explicitly explains this rule. A rate timeline prevents a newly edited rent from leaking into an ungenerated historical month.
- Collected is payments **applied to the selected billing month**, regardless of their actual payment dates. Expected is that month's stored charges. Remaining is the sum of `max(0, charge − payments)` per charge. Progress is zero for an empty month. Status is UNPAID, PARTIAL, or PAID according to the recorded amount.
- Overpayments are rejected. Both repository checks and SQLite insert/update triggers enforce the limit. There is no credit workflow in V1.
- All repository writes run through one serialized queue and SQLite transactions on the provider connection. This preserves connection-local foreign-key enforcement and prevents interleaved writes and double-tap races. Forms also lock submissions. Queries use bound parameters.
- Archiving preserves history through an explicit final billing month. Later unpaid charges are removed only after confirmation; later payments block archiving until corrected or a later final month is chosen. Tenants cannot be permanently deleted through the app.
- Relevant screens reload from SQLite on navigation focus and after writes.

## Backup and restore

1. Open **Settings → Backup & Restore → Export Backup**.
2. In Android's share sheet choose a file-saving destination or an app that stores the JSON outside RentLedger. A locally stored destination works without internet. Availability of individual destinations depends on your phone.
3. Verify that the JSON file is present and readable in that destination before changing phones or clearing Expo Go storage. Dismissing the share sheet does not prove a file was saved.
4. On the receiving phone open **Settings → Backup & Restore → Choose Backup File** and select the saved JSON. The picker copies it into app cache for reading.
5. Review tenant, charge, and payment counts, export time, and the replacement warning. Export the current ledger first if needed. Select **Replace records with this backup** and confirm.

New JSON backups use `schemaVersion: 3` and include `exportedAt`, tenants, rates, charges, payments, and settings. Original version-1 and version-2 backups remain importable. Version 3 also preserves receipt snapshots and print attempts; older APKs cannot read version-3 backups, so use the updated app when restoring them. Validation checks record types and field bounds, identifiers and uniqueness, rental periods, dates, positive integer monetary values, due days, rate coverage, foreign-key relationships, duplicate tenant/month charges, and overpayments. Files are limited to 20 MB and each collection to 100,000 records. Validation finishes **before deletion**. Replacement then occurs inside one transaction, including a final foreign-key check; a failure rolls back the entire restore.

Export files are staged in app documents and retained so a receiving Android app can read the shared URI after the chooser closes. These internal copies are not a replacement for saving externally and disappear if app storage is cleared. Picked cache copies are removed after reading. JSON backups are readable, unencrypted personal data; store them privately.

All backup modules are SDK-matched Expo modules. Android's actual picker/share interaction still requires physical-phone testing. The app is Android-first; web SQLite is not configured or supported in this version.

## Source layout

```text
src/app/          Expo Router tabs and detail/form routes
src/components/   Reusable mobile UI primitives and action guards
src/screens/      Shared monthly dashboard and records screen
src/hooks/        Focus-based loading and shared month selection
src/core/         Pure dates, centavos, status, totals, backup validation
src/database/     Schema, migrations, transactional repository
tests/            Pure-function and actual SQLite repository tests
```

## Validation and phone acceptance check

Automated coverage includes month/year transitions and leap dates, initial start month, exact centavos and rejected extra precision, partial/full payments, totals and zero-expected progress, overpayment rejection, idempotent charge generation and concurrent saves, payment editing/deletion, rent changes and historical snapshots, archiving, backup integrity and round trips, rollback on simulated storage failure, and close/reopen file persistence.

Before relying on a real ledger, run this on a physical Android phone:

1. Add a tenant at ₱3,000 for the current month. Expect ₱3,000 expected, ₱0 collected, and UNPAID.
2. Record ₱1,000. Expect PARTIAL, ₱1,000 collected, and ₱2,000 remaining. Try an overpayment and confirm it is rejected.
3. Record ₱2,000. Expect PAID, ₱3,000 collected, and ₱0 remaining.
4. Force-close and reopen. Verify records persist. Advance a month and verify the new charge, then return and verify the original history.
5. Edit and delete a mistaken payment. Verify totals change and confirmation dialogs work.
6. Change rent, review the effective-month explanation, browse a new future month and an unopened older month. Check snapshots remain correct.
7. Export and save externally; import that file and verify the review/confirmation flow and restored totals.
8. Check Android back behavior, long names, keyboard visibility, large text settings, touch targets, screen insets, and scrolling on a 360–430 px-wide phone.

Physical-device behavior has not been verified by the implementation environment. A successful Android bundle is a compilation check, not a claim of device testing. Changes are local; no commits or pushes are performed.

## Bluetooth receipts

Settings now includes Bluetooth printer selection, connection status, 58/80 mm layouts, test printing, auto-print and configurable business details. Payments have receipt history, previews, confirmed reprints and Unicode digital exports. Printing starts only after payment/receipt persistence. Read [PRINTING.md](PRINTING.md) for supported hardware, permissions, development/production builds, migrations, reliability rules and physical-device acceptance tests. Bluetooth needs a new native build; existing APKs and Expo Go retain core ledger/digital-receipt functionality. No new APK has been built by this change.

## Navigation and mobile layout

Settings includes separate Bluetooth Printer and Business Information screens. Owner/manager details appear on new receipt snapshots. Tabs and standalone screens share measured safe-area handling, keyboard-aware scrolling, and concise labels. See [UI_QA.md](UI_QA.md) for layout ownership, checks, physical-device testing, and development-build commands.
