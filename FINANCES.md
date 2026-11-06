# Expenses and profit tracking

RentLedger 1.1.0 keeps four main tabs: Home, Tenants, Finances, Settings. Payment History is accessible from Finances and Settings. The previous Records route redirects there. Existing tenant payment management and receipt reprints remain accessible.

## Accounting

- Home's **Collected · Billing month**, expected rent, and remaining balances retain their original billing-month rules.
- Finances **Rent Collected** is cash income: the sum of payments whose actual local `date` falls within the selected calendar month. It includes partial and late payments and payments from archived tenants. Voided receipt snapshots and reprints are never counted as additional income.
- **Total Expenses** sums saved expense amounts by their expense date.
- **Net Profit = cash income − expenses**. Negative amounts display as **Net Loss**. The compact Home card uses this same cash calculation and opens Finances.
- For example, PHP 1,000 received on November 3 for an October charge counts as November cash income while settling October's rent. PHP 1,250 of November expenses gives a PHP 250 November loss. This example is documentation only; no data is seeded.
- Changing or deleting a mistaken payment updates its cash reports. Editing an expense date moves it between the corresponding expense months. No month transition resets records.

## Use

1. Open Finances and choose a month with the existing month/year navigation.
2. Tap Add Expense. Description, positive PHP amount, and `YYYY-MM-DD` date are required. A past/future selected month starts the form on its first day; the current month uses today's local date.
3. Use category shortcuts (Utilities, Cleaning, Repairs, Supplies, Other), enter a custom category, or leave category blank. Blank categories appear under Other in the breakdown. Descriptions such as Cleaners, Tubig, and Kuryente are unrestricted text within the length limit.
4. Save to return to the refreshed list. Edit and Delete actions require confirmation. Home and Finances refetch when focused, so their totals reflect saved changes.

Amounts are integer centavos. Zero, negatives, non-finite values, fractional centavos, and amounts above PHP 1 billion are rejected. Description/category/notes are bounded to 160/80/2,000 characters. Forms guard double taps and keep one stable expense ID; SQLite rejects duplicate IDs. All user text is passed as bound query parameters.

## Storage and backups

Database version 4 adds `expenses(id, description, category, amount, date, notes, createdAt, updatedAt)` and indexes expense/payment dates. Existing versions 1–3 migrate transactionally. Version-3 tenant/payment/receipt/business/printer data is preserved; a failed migration rolls back to the old schema. Created timestamps stay unchanged on edits; updated timestamps advance without going backwards.

Expense records use the existing `rentledger.db`, shared write queue, foreign-key enforcement and transaction infrastructure. Cash reports read income, costs, list and breakdown in one transaction. All feature operations are offline; no backend or new native module was added.

JSON backups use schemaVersion 4 and include expenses and their timestamps. Versions 1–3 still import, with zero expenses because those formats had no expense collection. Restore replaces **all** records, including current expenses, after review and explicit confirmation. Expense identifiers, uniqueness, bounds, calendar dates and ISO timestamps are validated before replacement. Restore failures roll back the full ledger. Device-specific printer settings continue to be cleared on restore, as before. Old APKs cannot read schema-4 databases or backups; export before changing app versions and use the updated app for restoring.

## Verification

November 3, 2026: 56/56 tests passed; TypeScript, Expo lint, SDK dependency checks, and Android/iOS production bundle exports passed. Expo Doctor passed 20/20 on retry after its first React Native Directory request returned a temporary server error. No dependencies were upgraded or added.

```powershell
npm test
npx tsc --noEmit
npx expo lint
npx expo-doctor
npx expo install --check
npx expo export --platform android --platform ios --output-dir .expo/finances-validation
node tests/layout-preview.cjs
```

The financial/SQLite suite covers expense CRUD and validation, centavos, duplicate saves, late/partial payment dates, payment corrections/deletions, losses, category totals, month/year/leap boundaries, file-backed persistence, schema-3 migration and rollback, version-4 backup round trips, version-3 import, malformed backup rejection, and restore rollback. The existing payment/printing suite runs alongside these checks.

Responsive previews render the actual Home, Finances and expense form at 360/390/430px, using isolated preview data and simulated safe areas. They are not physical-device verification. Shared Page wrappers and the existing measured tab safe-area logic remain in use.

On Android, manually verify gesture and three-button navigation, keyboard scrolling to Save, increased text sizes, Add/Edit/Delete confirmations, returning between Home and Finances, app close/reopen, and backup export/import on a copy. Confirm old rent totals and Bluetooth reprinting still work on your actual phone/printer. No physical device or printer was used for this implementation validation.

The source is version 1.1.0 (Android version code 3). The previously distributed 1.0.1 APK does not include this feature. Reload Metro for development testing; deploy a new standalone APK to update the owner app. No new cloud build or GitHub push is performed as part of this source update.
