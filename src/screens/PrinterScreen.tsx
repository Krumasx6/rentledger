import { Linking, Platform, Text, View } from "react-native";
import { router } from "expo-router";
import {
  Button,
  Card,
  Page,
  ToggleRow,
  confirm,
  s,
  useAction,
} from "../components/ui";
import { usePrinter } from "../printing/PrinterProvider";
import { settingsRoutes } from "../core/layout";
export default function PrinterScreen() {
  const printer = usePrinter();
  const { busy, run } = useAction();
  const toggle = (key: "autoPrint" | "reconnect", value: boolean) =>
    void run(() => printer.update({ [key]: value }));
  const states: Record<string, string> = {
    disconnected: "Disconnected",
    connected: "Connected",
    connecting: "Connecting…",
    discovering: "Searching…",
    error: "Connection failed",
  };
  return (
    <Page title="Bluetooth Printer" back>
      <Card>
        <View style={s.between}>
          <Text style={[s.h2, { flex: 1 }]}>
            {printer.preferences.selected?.name || "No printer selected"}
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            style={[
              s.label,
              {
                color:
                  printer.connection === "connected" ? "#157354" : "#69766F",
              },
            ]}
          >
            {printer.supported ? states[printer.connection] : "Unavailable"}
          </Text>
        </View>
        {!printer.supported && (
          <Text style={s.subtitle}>
            Printing needs the latest RentLedger testing build.
          </Text>
        )}
        {!!printer.message && (
          <Text accessibilityLiveRegion="polite" style={s.subtitle}>
            {printer.message}
          </Text>
        )}
        <Text style={s.subtitle}>
          {Platform.OS === "ios"
            ? "Use a compatible BLE receipt printer."
            : "Pair the printer in Bluetooth settings first."}
        </Text>
        <Button
          title={
            Platform.OS === "android" ? "Bluetooth settings" : "App permissions"
          }
          secondary
          onPress={() =>
            void run(async () => {
              if (Platform.OS === "android")
                await Linking.sendIntent("android.settings.BLUETOOTH_SETTINGS");
              else await Linking.openSettings();
            })
          }
        />
        <Button
          title={busy ? "Please wait…" : "Find Printers"}
          disabled={busy || !printer.ready || !printer.supported}
          onPress={() => void run(printer.discover)}
        />
        {printer.devices.map((d) => (
          <View
            key={d.id}
            style={[
              s.between,
              { borderTopWidth: 1, borderTopColor: "#E1E6DE", paddingTop: 12 },
            ]}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.text}>{d.name || "Unnamed device"}</Text>
              <Text selectable style={s.label}>
                {d.address || d.id}
              </Text>
            </View>
            <Button
              title="Connect"
              disabled={busy}
              onPress={() => void run(() => printer.connect(d))}
            />
          </View>
        ))}
        {printer.preferences.selected && (
          <>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Reconnect"
                  secondary
                  disabled={busy || !printer.supported}
                  onPress={() =>
                    void run(() =>
                      printer.connect(printer.preferences.selected!),
                    )
                  }
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Disconnect"
                  secondary
                  disabled={busy || !printer.supported}
                  onPress={() => void run(printer.disconnect)}
                />
              </View>
            </View>
            <Button
              title="Forget Printer"
              danger
              disabled={busy}
              onPress={() =>
                confirm(
                  "Forget printer?",
                  "Auto-print will be turned off.",
                  () =>
                    void run(async () => {
                      await printer.disconnect();
                      await printer.update({
                        selected: null,
                        autoPrint: false,
                      });
                    }),
                  true,
                )
              }
            />
          </>
        )}
      </Card>
      <Card>
        <ToggleRow
          label="Auto-print Receipts"
          value={printer.preferences.autoPrint}
          disabled={busy || !printer.ready}
          onChange={(v) => toggle("autoPrint", v)}
        />
        <ToggleRow
          label="Auto-reconnect"
          value={printer.preferences.reconnect}
          disabled={busy || !printer.ready}
          onChange={(v) => toggle("reconnect", v)}
        />
        <Text style={s.label}>Paper Width</Text>
        <View style={s.row}>
          {([58, 80] as const).map((width) => (
            <View key={width} style={{ flex: 1 }}>
              <Button
                title={`${width} mm${printer.preferences.width === width ? " ✓" : ""}`}
                secondary={printer.preferences.width !== width}
                disabled={busy}
                onPress={() => void run(() => printer.update({ width }))}
              />
            </View>
          ))}
        </View>
        <Button
          title="Test Print"
          disabled={
            busy || !printer.supported || printer.connection !== "connected"
          }
          onPress={() => void run(printer.test)}
        />
        <Text style={s.subtitle}>Check the paper after sending.</Text>
      </Card>
      <Button
        title="Business Information"
        secondary
        onPress={() => router.push(settingsRoutes.business)}
      />
    </Page>
  );
}
