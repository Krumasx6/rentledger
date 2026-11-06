# Bluetooth thermal receipts

## Supported setup

The implementation adds `rn-escpos-printer` 1.0.2, a New Architecture/TurboModule ESC/POS transport, to the existing Expo SDK 58 / React Native 0.88.1 application. Its published peer range is React Native >=0.76 and React any version. The package's release metadata, TypeScript API, Android manifest/build configuration, and iOS implementation were evaluated; this is not a claim of physical compatibility testing on SDK 58. Native compilation and actual printer operation must be checked on the target hardware before relying on printing.

The other evaluated options included `@netinove/thermal-printer` 1.0.0 (its declared Expo <55 / RN <0.82 peer ranges exclude this project) and `@ricka7x/expo-thermal-printer` 0.1.3 (an Expo Modules alternative). The selected package supplies Classic/BLE transport, connection checks, write serialization, chunking and flow control without adding another Bluetooth transport dependency. It has a small, recent release history rather than a long device-certification history. Keep the lockfile and validate your printer model.

- **Android:** ESC/POS over **Bluetooth Classic SPP/RFCOMM**. Pair in Android's Bluetooth settings first. Discovery lists bonded devices; it does not perform a broad scan or request location. A paired headset can appear too: selection is not proof of ESC/POS support. BLE-only Android printers are outside this adapter's support.
- **iOS:** ESC/POS over **BLE with a writable GATT characteristic**. Classic-only printers do not work through generic iOS Bluetooth. Dual-mode devices must advertise a compatible BLE interface. An unsupported vendor protocol, a locked characteristic, or a non-ESC/POS printer may connect but cannot reliably print this layout. MFi/vendor-specific integrations are not implemented.
- **Paper:** 58 mm uses 32 ASCII columns; 80 mm uses 48. Actual printable width/font varies by printer firmware. Run Test Print and choose the fitting width. Text uses ESC/POS initialization, CP850, five feed lines and no cut command, for compatibility with small printers that have no cutter.
- Printer status reflects the native transport. A powered-off remote device may only be detected on the next write; a connected socket is not a physical paper-status query.
- No network service is used for printing, payment records, or receipt storage.

Library documentation: [rn-escpos-printer](https://github.com/richardfariax/rn-escpos-printer). Expo documents why additional native modules need a [development or production build](https://docs.expo.dev/develop/development-builds/introduction/).

## Build requirements

Bluetooth does **not** work in Expo Go, or in an old APK built before this dependency was added. The guarded native adapter keeps the rest of the app functional there: saving payments, receipt previews, digital sharing, backups and existing ledger features still work. Printer Settings shows an explicit unsupported-build message.

For a native Android development client:

```powershell
npx eas-cli@latest build --platform android --profile development
npx expo start --dev-client
```

Install the development build first, then open its development-server link. `expo-dev-client` is installed with the SDK-compatible version. The development profile uses the existing Android local credentials. Building uploads source to EAS and may require the workspace's separate upload approval; no cloud build or signing operation is performed automatically by this feature implementation.

For a standalone Android APK, use the existing preview profile:

```powershell
npx eas-cli@latest build --platform android --profile preview
```

For an iOS development build, configure Apple signing and a registered device, then use:

```powershell
npx eas-cli@latest build --platform ios --profile development
```

These commands require the relevant Expo account/signing access. No native `ios/` or `android/` files are hand-maintained. A JS-only repack of the previous APK cannot add Bluetooth support; the obsolete due-day repack workflow has been removed.

To continue checking ledger/digital receipt functionality in Expo Go:

```powershell
npx expo start --go
# Only after a successful online launch has cached the project's development certificate:
npx expo start --offline --go
```

Expo Go must match SDK 58. If the CLI reports that no cached development certificate exists, start online, sign in to Expo CLI and Expo Go with the same account, and open the project once before using offline mode. Offline mode cannot create the missing certificate. `Cannot find native module 'ExpoSQLite'` means the running native client does not expose this required module; check the installed Expo Go SDK/build, or install the development build above. Route-default-export warnings can follow that failed import even though the screens have valid default exports. Do not clear app storage or substitute in-memory storage to address this error.

## Permissions and connection

1. Open **Settings → Bluetooth Printer**.
2. On Android pair the printer in system Bluetooth settings, return, and tap **Find Printers**. Android 12+ prompts for Nearby devices / `BLUETOOTH_CONNECT`. The library declares legacy Bluetooth permissions through Android 11. No Android BLE scan or location permission is requested because discovery is bonded-device-only.
3. On iOS enable Bluetooth and scan. `app.json` declares `NSBluetoothAlwaysUsageDescription`; CoreBluetooth handles the OS consent prompt. Only compatible BLE peripherals can be used.
4. Select a device and connect. If permissions are denied or permanently blocked, the app explains the error and offers system settings. Other devices and unsupported transports are not silently treated as compatible printers.
5. Select **58 mm** or **80 mm**, open Business Information to configure the business name, owner/manager, address, contact and footer, and run **Test Print**. A test is prominently labelled and creates no financial transaction or receipt number.
6. Enable **Auto-print Receipts** if desired. It defaults off. Selected device, paper width, auto-print and reconnect preference are stored in SQLite settings.

Reconnect checks run while the app is active, with at most one connection attempt every 30 seconds. They reuse the saved platform-specific device identifier and do not repeatedly ask Android for denied permission. Manual disconnect pauses reconnect until explicitly re-enabled or connected again. Forget clears the remembered printer and disables auto-print. Reconnect never replays old print jobs.

## Payment and receipt consistency

- One SQLite transaction validates and inserts/updates the payment, checks the remaining balance, and saves a receipt snapshot. A failure at any step rolls back the payment and receipt together.
- Each receipt has a UUID-backed unique `RL-...` reference, a unique stored identifier and a payment revision. Numbering is persisted and backed up, not a counter in React state.
- Receipt snapshots preserve business details, tenant name, room/bed, billing month, charge, this payment, balance **at receipt issuance**, payment date/time, method, reference and recording time. Later tenant/rent/business changes or later partial payments do not rewrite the original receipt.
- Only after the transaction commits does the app attempt auto-print. Printing failure never reverses a saved payment and retry never invokes payment saving.
- Correcting a payment voids its previous active receipt and creates a new correction revision/reference. Deleting a mistaken payment marks its receipts void and retains them as historical snapshots. Voided receipts can be viewed/shared with a clear VOID label; they cannot be printed as active receipts.
- Reprint reads the saved snapshot and original reference. It requires confirmation, especially when a prior result was uncertain. It does not regenerate a receipt from current tenant details or create another payment.
- Paper receipts transliterate accented Latin text and use `PHP 1,000.00` instead of an unreliable peso glyph. Control characters from user input cannot inject ESC/POS commands. Unsupported non-Latin characters cannot be represented by the ASCII thermal layout; digital previews and shared UTF-8 `.txt` receipts preserve full Unicode names.
- Receipts are rental payment acknowledgements. There is no BIR official-receipt or tax-invoice configuration, and the app does not label them as those documents.

## Print results

### Save and print (November 3, 2026)

On the payment form, enable **Print after saving**. This is the same SQLite-backed preference as **Auto-print Receipts** in Printer Settings; it remains off until enabled. The action then reads **Save & Print**. Saving is disabled while preferences initially load so it cannot silently use an unloaded default. Corrections continue to require an explicit reprint.

After the payment and receipt commit, the form clears and shows the saved receipt. The print attempt waits for an in-progress printer connection operation instead of skipping it as busy. If disconnected, a remembered printer gets one connection attempt when Auto-reconnect is enabled. A manually disconnected printer respects the paused reconnect setting. No write is automatically retried, because a failed write might already have produced paper. Failures show a warning and **View Receipt** without creating another payment.

These changes use existing native APIs and do not add a native dependency. An existing compatible development client can load them through Metro. An installed standalone APK needs an updated application bundle/build. Five additional regression tests cover saving during reconnect, reconnect before a full-payment print, reconnect failure and original-receipt reprint, paused reconnect/uncertain writes, and failed persistence preventing all connection/print activity. The current suite has 45 tests. Physical printer output remains unverified here.

The UI exposes connection/discovery state and print state. Persisted attempts are `sending`, `transmitted`, `skipped`, `failed`, or `unknown`.

- **Transmitted:** the transport accepted the data. It does **not** prove paper was printed, paper is present, or the output was readable.
- **Skipped:** no connection, busy printer, or an existing automatic attempt. The payment and receipt remain saved for an explicit reprint.
- **Failed:** the operation could not reach the transmission stage.
- **Unknown:** a write was started and then failed, or the app closed while sending. Some/all paper may already have printed. Check the physical printer before confirming another copy.

Application locks serialize printing, financial writes are queued, and SQLite prevents two simultaneous `sending` attempts for one receipt. An automatic attempt is never automatically repeated; manual reprints are explicit. There is no silent durable queue that sends potentially duplicated receipts after a restart. Interrupted jobs are marked unknown on startup.

## Migrations and backup

Schema version 3 adds payment metadata, `receipts` and `print_attempts` without removing prior financial data. Version-1 and version-2 databases upgrade transactionally. Earlier payments get one historical receipt on upgrade; missing time/method is labelled **Not recorded**, not fabricated. Legacy balances are reconstructed in date/row order from the surviving payment history, so they are historical reconstructions rather than proof of the original payment-entry sequence.

JSON backups now use schemaVersion 4 and include expenses, receipt snapshots, void/revision history and print attempts. Versions 1, 2 and 3 remain importable, with historical receipts created once on restore. Validation checks unique references, identifiers, active-receipt/payment relationships, monetary bounds, dates, and print statuses before any replacement. Restore remains atomic. Device-specific printer selection/auto-print is cleared after import and must be configured on the receiving phone. An interrupted sending state restores as unknown, never as an automatic retry. Versions before 1.1.0 cannot import version-4 backups.

## Verification

Implementation checks completed on November 2, 2026:

| Check                                                            | Result                |
| ---------------------------------------------------------------- | --------------------- |
| Automated financial, receipt, printer-adapter and recovery tests | 40/40 passed          |
| TypeScript (`npx tsc --noEmit`)                                  | Passed                |
| Expo lint                                                        | Passed                |
| Expo SDK dependency compatibility                                | Passed                |
| Expo Doctor                                                      | 20/20 passed          |
| Android and iOS JavaScript bundle export                         | Passed                |
| Native Android/iOS binary compilation                            | Not run               |
| Bluetooth transmission and paper output                          | Not physically tested |

Run `npm test`, `npx tsc --noEmit`, `npx expo lint`, `npx expo install --check`, and `npx expo-doctor`. Repository tests use isolated real SQLite databases; printer transports are mocked. They cover persistence-before-send, failed payment/receipt persistence, disconnects, uncertain partial transmission, partial payments, duplicate submissions/print clicks, immutable reprints, correction/void history, both paper widths/control sanitization, receipt backup integrity, old-schema migration and interrupted-job recovery. No production records are created or cleared by tests.

**Not physically verified:** Bluetooth printing and native builds have not been tested on a compatible physical printer/device in this environment. JavaScript bundle compilation does not verify radio behavior, native linking, firmware, encoding, or paper output.

Before use, test Android Nearby devices denial/blocking, Bluetooth off, initial pairing, successful test print at both widths, long names/references, a full and partial payment, power-off mid-write, app background/foreground, restart mid-send, reconnect without replay, manual retry/reprint without duplicate payments, corrected/deleted receipt labels, and backup restore. On an actual iPhone also verify BLE discovery, consent denial, characteristic compatibility/backpressure and refusal of a Classic-only printer. Check every supported printer model/firmware and verify signing/build compatibility on both platforms.
