import {
  PermissionsAndroid,
  Platform,
  TurboModuleRegistry,
} from "react-native";
import type { EscPosPrinter, PrinterDevice } from "rn-escpos-printer";
export type Device = PrinterDevice;
type Api = typeof EscPosPrinter;
const unsupported =
  "Printer support is unavailable in this build. Open the latest RentLedger testing app.";
function native(): Api {
  if (
    !["android", "ios"].includes(Platform.OS) ||
    !TurboModuleRegistry.get("RnEscposPrinter")
  )
    throw new Error(unsupported);
  // The package uses getEnforcing at import time. Load it only after the native
  // module is present, so Expo Go never crashes merely by opening Settings.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Deliberately deferred behind the native module guard.
  return (require("rn-escpos-printer") as { EscPosPrinter: Api }).EscPosPrinter;
}
export const bluetooth = {
  supported: () =>
    ["android", "ios"].includes(Platform.OS) &&
    !!TurboModuleRegistry.get("RnEscposPrinter"),
  async permission(request: boolean) {
    if (!this.supported()) throw new Error(unsupported);
    if (Platform.OS === "android" && Number(Platform.Version) >= 31) {
      const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
      if (await PermissionsAndroid.check(permission)) return;
      if (!request)
        throw new Error(
          "Nearby devices permission is not granted. Connect from Printer Settings.",
        );
      const result = await PermissionsAndroid.request(permission, {
        title: "Connect a receipt printer",
        message:
          "RentLedger uses Bluetooth to send rental payment receipts to your selected printer.",
        buttonPositive: "Allow",
        buttonNegative: "Cancel",
      });
      if (result !== PermissionsAndroid.RESULTS.GRANTED)
        throw new Error(
          result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
            ? "Nearby devices permission is blocked. Enable it in Android app settings."
            : "Bluetooth permission was denied. Payments and digital receipts still work.",
        );
    }
    await native().initialize();
  },
  async discover() {
    await this.permission(true);
    return native().getPrinters({ scanDurationMs: 5000 });
  },
  async connect(device: Device, request = true) {
    await this.permission(request);
    if (
      (Platform.OS === "android" && device.transport !== "bluetooth-classic") ||
      (Platform.OS === "ios" && device.transport !== "ble")
    )
      throw new Error(
        "This printer transport is not supported on this phone. Android uses Classic SPP; iOS requires writable BLE GATT.",
      );
    await native().connect(device.id, { timeoutMs: 12000 });
  },
  async disconnect() {
    if (this.supported()) await native().disconnect();
  },
  async isConnected() {
    if (!this.supported()) return false;
    try {
      return await native().isConnected();
    } catch {
      return false;
    }
  },
  async write(text: string) {
    await native().printText(text, {
      codePage: "cp850",
      feedLines: 5,
      cut: false,
    });
  },
};
