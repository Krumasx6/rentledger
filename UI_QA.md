# UI and Android layout verification

## Implementation

- Settings opens registered Bluetooth Printer, Business Information, Receipts, Backup & Restore, and About routes. Older `/printer` and `/business` links redirect to the current screens.
- One root SafeAreaProvider supplies device insets. Tab screens consume top and side insets; the navigator consumes the bottom inset once. Standalone screens consume all four edges. No fixed Android navigation offset or hidden system bar is used.
- The existing four tabs remain in normal layout flow. Their touch area is 56 points plus the measured bottom inset, expanding for larger text. Scrolling content is laid out above them.
- Android uses native keyboard resize; iOS uses KeyboardAvoidingView. Tabs hide while typing. Forms scroll, accept button taps with the keyboard open, and include end spacing. Bottom safe-area padding is removed while the keyboard occupies that area.
- Shared spacing, compact headers, short labels, and Settings rows replace repetitive instructions and duplicate navigation controls. Financial values, validation, correction confirmations, and restore warnings remain.
- Business information is stored in existing SQLite settings. Owner/manager is optional for compatibility with old backups. New receipts capture it; previous receipt snapshots stay unchanged.

## Automated checks

Run:

```sh
npm test
npx tsc --noEmit
npx expo lint
npx expo-doctor
npx expo install --check
npx expo export --platform android --platform ios --output-dir .expo/validation-export
node tests/layout-preview.cjs
```

The suite covers financial persistence, receipt snapshots and reprints, printer failures, business settings, route registration, 360/390/430px card geometry, navigation insets, and increased font scale. Component fixtures are generated at `.expo/layout-qa/index.html` using the shared Page and BusinessForm components. Fixtures and mathematical checks do not verify native screen rendering or real keyboard behavior; browser visual inspection was unavailable in this environment.

## Required physical-device checks

On a small Android phone, test both gesture and three-button navigation. Visit all four tabs, tenant details/edit, payment history/edit, receipts, printer settings, business information, backup, and About. Confirm the status bar and system controls stay clear; scroll to each last item and tap its final action. Open the keyboard at the first and last form fields, scroll to Save, save, and close the keyboard. Repeat with increased system font size. Check native back navigation and printer permission denial.

Test Bluetooth on an actual compatible printer as described in PRINTING.md. Neither native navigation/keyboard behavior nor paper output has been physically verified here.

## Run the updated testing app

Bluetooth and native keyboard configuration require a new development build when the installed testing APK predates these changes:

```powershell
npx eas-cli@latest build --platform android --profile development
# Install that testing APK, then start Metro:
npx expo start --dev-client --clear
```

Subsequent JavaScript-only edits use Metro without rebuilding. Expo Go supports the ledger and digital receipts, but cannot load the Bluetooth printer module. Keep the existing package and signing identity when updating an installed app; do not uninstall or clear storage without a backup. This source update does not submit a cloud build or push to GitHub.
